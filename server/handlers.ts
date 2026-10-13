import { timingSafeEqual } from "node:crypto";
import { agentContext, localClock, todaysReminders, unreadFamilyMessages } from "../src/shared/household";
import type { HouseholdAction } from "../src/shared/types";
import { mutate, sha256, SupabaseStore, type HouseholdStore } from "./store";

// Framework-agnostic request handlers. `api/*.ts` adapts them for Vercel and
// vite.config.ts mounts them on the dev server, so both run the same code.

export interface ApiRequest {
  method: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ServerEnv {
  store: HouseholdStore | null;
  elevenLabsApiKey?: string;
  elevenLabsAgentId?: string;
  toolSecret?: string;
  fetch: typeof fetch;
}

export function envFromProcess(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  return {
    store:
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
        : null,
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    elevenLabsAgentId: env.ELEVENLABS_AGENT_ID,
    toolSecret: env.KINLY_TOOL_SECRET,
    fetch: globalThis.fetch,
  };
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Household id + PIN, sent by the elder screen and the family dashboard. */
async function authorizeHousehold(env: ServerEnv, req: ApiRequest) {
  if (!env.store) return { error: json(503, { error: "Cloud storage is not configured." }) };
  const id = req.query.id;
  const pin = req.headers["x-kinly-pin"];
  if (!id || !pin) return { error: json(401, { error: "Household code and PIN are required." }) };
  const row = await env.store.load(id);
  if (!row || !safeEqual(row.pinHash, await sha256(`${id}:${pin}`))) {
    return { error: json(401, { error: "Household code or PIN is wrong." }) };
  }
  return { row, store: env.store, id };
}

export async function handleConfig(env: ServerEnv): Promise<ApiResponse> {
  return json(200, {
    cloud: Boolean(env.store),
    voice: Boolean(env.elevenLabsApiKey && env.elevenLabsAgentId),
  });
}

// Only actions a screen may send; everything else is rejected.
const CLIENT_ACTIONS = new Set<HouseholdAction["type"]>([
  "confirmReminder",
  "markMissed",
  "saveReminder",
  "deleteReminder",
  "familyMessage",
  "elderMessage",
  "markMessagesRead",
  "raiseAlert",
  "acknowledgeAlert",
  "updateElder",
  "saveFamilyMember",
  "deleteFamilyMember",
]);

export async function handleHousehold(env: ServerEnv, req: ApiRequest): Promise<ApiResponse> {
  const auth = await authorizeHousehold(env, req);
  if ("error" in auth) return auth.error!;
  if (req.method === "GET") return json(200, auth.row.household);
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const actions = (req.body as { actions?: unknown })?.actions;
  if (
    !Array.isArray(actions) ||
    actions.length === 0 ||
    actions.length > 20 ||
    !actions.every((a) => a && typeof a === "object" && CLIENT_ACTIONS.has(a.type))
  ) {
    return json(400, { error: "Expected { actions: [...] }." });
  }
  const next = await mutate(auth.store, auth.id, actions as HouseholdAction[]);
  return json(200, next);
}

/** Mints a short-lived ElevenLabs conversation token so the API key never reaches the device. */
export async function handleSession(env: ServerEnv, req: ApiRequest): Promise<ApiResponse> {
  const auth = await authorizeHousehold(env, req);
  if ("error" in auth) return auth.error!;
  if (!env.elevenLabsApiKey || !env.elevenLabsAgentId) {
    return json(503, { error: "Voice is not configured." });
  }
  const res = await env.fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(env.elevenLabsAgentId)}`,
    { headers: { "xi-api-key": env.elevenLabsApiKey } },
  );
  if (!res.ok) return json(502, { error: `ElevenLabs refused the session (${res.status}).` });
  const { token } = (await res.json()) as { token: string };
  return json(200, { token, dynamicVariables: agentContext(auth.row.household) });
}

type ToolParams = Record<string, unknown> & { household_id?: string };

/**
 * Webhook tools called by the ElevenLabs agent. Because they live on the
 * server (not in the browser), the same agent works on the face app today and
 * over a phone call later.
 */
export async function handleTool(
  env: ServerEnv,
  name: string,
  req: ApiRequest,
): Promise<ApiResponse> {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  const secret = req.headers["x-kinly-tool-secret"];
  if (!env.toolSecret || !secret || !safeEqual(secret, env.toolSecret)) {
    return json(401, { error: "Unauthorized." });
  }
  if (!env.store) return json(503, { error: "Cloud storage is not configured." });

  const params = (req.body ?? {}) as ToolParams;
  const id = typeof params.household_id === "string" ? params.household_id : "";
  const row = id ? await env.store.load(id) : null;
  if (!row) return json(404, { error: "Unknown household." });
  const household = row.household;
  const now = new Date();
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string).trim() : "");

  switch (name) {
    case "get_reminders": {
      const today = todaysReminders(household, now).map((t) => ({
        reminder_id: t.reminder.id,
        time: t.reminder.time,
        kind: t.reminder.kind,
        label: t.reminder.label,
        instructions: t.reminder.instructions ?? null,
        status: t.status,
      }));
      return json(200, { local_time: agentContext(household, now).local_time, reminders: today });
    }
    case "confirm_reminder": {
      const reminderId = str("reminder_id");
      if (!household.reminders.some((r) => r.id === reminderId)) {
        return json(200, { ok: false, result: "No reminder with that id. Call get_reminders first." });
      }
      const { date } = localClock(now, household.elder.timezone);
      await mutate(env.store, id, [{ type: "confirmReminder", reminderId, date }]);
      return json(200, { ok: true, result: "Logged as taken. The family can see it." });
    }
    case "get_family_messages": {
      const unread = unreadFamilyMessages(household);
      if (unread.length) {
        await mutate(env.store, id, [{ type: "markMessagesRead", ids: unread.map((m) => m.id) }]);
      }
      return json(200, {
        messages: unread.map((m) => ({ from: m.familyName, text: m.text, sent_at: m.at })),
      });
    }
    case "send_family_message": {
      const familyName = str("family_name");
      const text = str("message");
      if (!text) return json(200, { ok: false, result: "The message was empty." });
      const known = household.family.find((f) => f.name.toLowerCase() === familyName.toLowerCase());
      await mutate(env.store, id, [
        { type: "elderMessage", familyName: known?.name ?? (familyName || "Family"), text: text.slice(0, 1000) },
      ]);
      return json(200, { ok: true, result: `Message sent to ${known?.name ?? "the family"}.` });
    }
    case "raise_alert": {
      const reason = str("reason") || "Asked for help during a conversation.";
      await mutate(env.store, id, [{ type: "raiseAlert", source: "voice", reason: reason.slice(0, 500) }]);
      return json(200, {
        ok: true,
        result: "The family has been alerted. Stay with the person and reassure them.",
      });
    }
    default:
      return json(404, { error: `Unknown tool "${name}".` });
  }
}
