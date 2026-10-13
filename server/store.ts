import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyAction } from "../src/shared/household";
import type { Household, HouseholdAction } from "../src/shared/types";

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

/** Apply actions with optimistic concurrency, retrying if another writer got there first. */
export async function mutate(
  store: HouseholdStore,
  id: string,
  actions: HouseholdAction[],
): Promise<Household | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await store.load(id);
    if (!row) return null;
    const now = new Date();
    const next = actions.reduce((h, a) => applyAction(h, a, now), row.household);
    if (await store.save(id, next, row.version)) return next;
  }
  throw new Error("Household is busy, please try again.");
}

export async function sha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
