import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyAction } from "../src/shared/household.js";
import type { Household, HouseholdAction } from "../src/shared/types.js";

export interface HouseholdRow {
  household: Household;
  pinHash: string;
  version: number;
}

export interface HouseholdStore {
  load(id: string): Promise<HouseholdRow | null>;
  /** Writes only if the stored version still equals `expectedVersion`. */
  save(id: string, household: Household, expectedVersion: number): Promise<boolean>;
  create(household: Household, pinHash: string): Promise<void>;
}

export class SupabaseStore implements HouseholdStore {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async load(id: string): Promise<HouseholdRow | null> {
    const { data, error } = await this.db
      .from("households")
      .select("state, pin_hash, version")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { household: data.state as Household, pinHash: data.pin_hash, version: data.version };
  }

  async save(id: string, household: Household, expectedVersion: number): Promise<boolean> {
    const { data, error } = await this.db
      .from("households")
      .update({ state: household, version: expectedVersion + 1, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("version", expectedVersion)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async create(household: Household, pinHash: string): Promise<void> {
    const { error } = await this.db
      .from("households")
      .insert({ id: household.id, state: household, pin_hash: pinHash, version: 0 });
    if (error) throw error;
  }
}

/** In-memory store for tests and for running the API without Supabase. */
export class MemoryStore implements HouseholdStore {
  rows = new Map<string, HouseholdRow>();

  async load(id: string) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async save(id: string, household: Household, expectedVersion: number) {
    const row = this.rows.get(id);
    if (!row || row.version !== expectedVersion) return false;
    this.rows.set(id, { ...row, household: structuredClone(household), version: expectedVersion + 1 });
    return true;
  }

  async create(household: Household, pinHash: string) {
    this.rows.set(household.id, { household: structuredClone(household), pinHash, version: 0 });
  }
}

/**
 * Apply a change with optimistic concurrency, retrying if another writer got
 * there first. Returns the state before and after the change that was saved.
 */
export async function update(
  store: HouseholdStore,
  id: string,
  change: (h: Household, now: Date) => Household,
): Promise<{ before: Household; after: Household } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await store.load(id);
    if (!row) return null;
    const after = change(row.household, new Date());
    if (await store.save(id, after, row.version)) return { before: row.household, after };
  }
  throw new Error("Household is busy, please try again.");
}

/** Apply household actions (see applyAction). */
export async function mutate(
  store: HouseholdStore,
  id: string,
  actions: HouseholdAction[],
): Promise<{ before: Household; after: Household } | null> {
  return update(store, id, (h, now) => actions.reduce((x, a) => applyAction(x, a, now), h));
}

export async function sha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
