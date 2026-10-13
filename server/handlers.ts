import { timingSafeEqual } from "node:crypto";
import {
  agentContext,
  localClock,
  overdueReminders,
  todaysReminders,
  unreadFamilyMessages,
} from "../src/shared/household.js";
import type { Household, HouseholdAction } from "../src/shared/types.js";
import { findAgentId, setupAgent } from "./agent-setup.js";
import {
  notificationsFor,
  sendAll,
  vapidKeys,
  verifyAckToken,
  webPushSender,
  type PushRecord,
  type PushSender,
} from "./push.js";
import { mutate, sha256, SupabaseStore, update, type HouseholdStore } from "./store.js";

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
  agentLlm?: string;
  voiceId?: string;
  ttsModel?: string;
  /** Overrides the real web push sender (tests). */
  pushSender?: PushSender;
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
    agentLlm: env.KINLY_AGENT_LLM,
    voiceId: env.ELEVENLABS_VOICE_ID,
    ttsModel: env.ELEVENLABS_TTS_MODEL,
    fetch: globalThis.fetch,
  };
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

/** What browsers see: everything except the push subscriptions. */
function publicView(h: Household): Omit<Household, "push"> {
  const { push: _push, ...rest } = h;
  void _push;
  return rest;
}

function pushSender(env: ServerEnv): PushSender | null {
  if (env.pushSender) return env.pushSender;
  if (!env.toolSecret) return null;
  return webPushSender(vapidKeys(env.toolSecret), process.env.VAPID_SUBJECT || "mailto:alerts@kinly.app");
}

/** Push alerts/messages that a change created, and forget phones that unsubscribed. */
async function notify(env: ServerEnv, change: { before: Household; after: Household } | null) {
  const send = pushSender(env);
  if (!change || !send || !env.store || !env.toolSecret) return;
  const gone = await sendAll(notificationsFor(change.before, change.after, env.toolSecret), send);
  if (gone.length) {
    await update(env.store, change.after.id, (h) => ({
      ...h,
      push: (h.push ?? []).filter((p) => !gone.includes(p.endpoint)),
    }));
  }
}

/** Apply actions, then send any notifications they call for. */
async function apply(env: ServerEnv, id: string, actions: HouseholdAction[]) {
  const change = await mutate(env.store!, id, actions);
  await notify(env, change);
  return change?.after ?? null;
}

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

// The agent is found by name, so nobody has to copy its id into Vercel.
// Cached per server instance; a miss is re-checked after a minute.
let agentCache: { key: string; id: string | null; at: number } | null = null;

export function resetAgentCache() {
  agentCache = null;
}

async function resolveAgentId(env: ServerEnv): Promise<string | null> {
  if (env.elevenLabsAgentId) return env.elevenLabsAgentId;
  if (!env.elevenLabsApiKey) return null;
  const fresh = agentCache && agentCache.key === env.elevenLabsApiKey && (agentCache.id || Date.now() - agentCache.at < 60_000);
  if (!fresh) {
    agentCache = { key: env.elevenLabsApiKey, id: await findAgentId(env.elevenLabsApiKey, env.fetch), at: Date.now() };
  }
  return agentCache!.id;
}

export async function handleConfig(env: ServerEnv): Promise<ApiResponse> {
  let agentReady = false;
  let voiceError: string | undefined;
  if (env.elevenLabsApiKey) {
    try {
      agentReady = Boolean(await resolveAgentId(env));
    } catch (e) {
      voiceError = (e as Error).message;
    }
  }
  return json(200, {
    cloud: Boolean(env.store),
    voice: agentReady,
    // Key is set but the agent doesn't exist yet: the dashboard offers to create it.
    voiceSetupAvailable: Boolean(env.elevenLabsApiKey && env.toolSecret && !agentReady),
    voiceError,
    pushPublicKey: env.store && env.toolSecret ? vapidKeys(env.toolSecret).publicKey : undefined,
  });
}

function isSubscription(x: unknown): x is Pick<PushRecord, "endpoint" | "keys"> {
  const s = x as PushRecord;
  return (
    !!s &&
    typeof s.endpoint === "string" &&
    s.endpoint.startsWith("https://") &&
    s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === "string" &&
    typeof s.keys?.auth === "string"
  );
}

/** Turn alerts on/off for this phone, or send it a test. */
export async function handlePush(env: ServerEnv, req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  const auth = await authorizeHousehold(env, req);
  if ("error" in auth) return auth.error!;
  const send = pushSender(env);
  if (!send) return json(503, { error: "Add KINLY_TOOL_SECRET in Vercel to use alerts." });
  const body = (req.body ?? {}) as { action?: string; subscription?: unknown; familyName?: string };
  if (!isSubscription(body.subscription)) return json(400, { error: "Missing push subscription." });
  const { endpoint, keys } = body.subscription;

  if (body.action === "subscribe") {
    const familyName = (body.familyName ?? "").trim().slice(0, 60) || "Family";
    await update(auth.store, auth.id, (h, now) => ({
      ...h,
      push: [
        ...(h.push ?? []).filter((p) => p.endpoint !== endpoint),
        { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, familyName, createdAt: now.toISOString() },
      ].slice(-50),
    }));
    return json(200, { ok: true });
  }
  if (body.action === "unsubscribe") {
    await update(auth.store, auth.id, (h) => ({ ...h, push: (h.push ?? []).filter((p) => p.endpoint !== endpoint) }));
    return json(200, { ok: true });
  }
  if (body.action === "test") {
    const result = await send(
      { endpoint, keys, familyName: body.familyName ?? "Family", createdAt: "" },
      {
        title: "Kinly alerts are on",
        body: `You'll be told here if ${auth.row.household.elder.name} needs help.`,
        tag: "kinly-test",
        url: "/family",
      },
    );
    return result === "ok" ? json(200, { ok: true }) : json(502, { error: "The phone's push service refused the test." });
  }
  return json(400, { error: "Unknown action." });
}

/** "I'm on it" pressed on a notification: acknowledged with a signed token instead of the PIN. */
export async function handlePushAck(env: ServerEnv, req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  if (!env.store || !env.toolSecret) return json(503, { error: "Not configured." });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const [householdId, alertId, by, token] = [b.householdId, b.alertId, b.by, b.token].map((v) =>
    typeof v === "string" ? v : "",
  );
  if (!householdId || !alertId || !by || !verifyAckToken(env.toolSecret, householdId, alertId, by, token)) {
    return json(401, { error: "Invalid link." });
  }
  const after = await apply(env, householdId, [{ type: "acknowledgeAlert", alertId, by }]);
  return after ? json(200, { ok: true }) : json(404, { error: "Unknown household." });
}

/** Creates or updates the Kinly agent from the deployed app. Any household member can run it. */
export async function handleSetupVoice(env: ServerEnv, req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  const auth = await authorizeHousehold(env, req);
  if ("error" in auth) return auth.error!;
  if (!env.elevenLabsApiKey) return json(503, { error: "Add ELEVENLABS_API_KEY in Vercel first." });
  if (!env.toolSecret) return json(503, { error: "Add KINLY_TOOL_SECRET in Vercel first." });
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  if (!host) return json(400, { error: "Could not tell this site's address." });
  const proto = req.headers["x-forwarded-proto"] ?? (host.startsWith("localhost") ? "http" : "https");
  try {
    const result = await setupAgent({
      apiKey: env.elevenLabsApiKey,
      publicUrl: `${proto}://${host}`,
      toolSecret: env.toolSecret,
      llm: env.agentLlm,
      voiceId: env.voiceId,
      ttsModel: env.ttsModel,
      fetch: env.fetch,
    });
    agentCache = { key: env.elevenLabsApiKey, id: result.agentId, at: Date.now() };
    return json(200, result);
  } catch (e) {
    return json(502, { error: (e as Error).message });
  }
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
  if (req.method === "GET") return json(200, publicView(auth.row.household));
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
  const next = await apply(env, auth.id, actions as HouseholdAction[]);
  return json(200, next && publicView(next));
}

/** Mints a short-lived ElevenLabs conversation token so the API key never reaches the device. */
export async function handleSession(env: ServerEnv, req: ApiRequest): Promise<ApiResponse> {
  const auth = await authorizeHousehold(env, req);
  if ("error" in auth) return auth.error!;
  const agentId = env.elevenLabsApiKey ? await resolveAgentId(env) : null;
  if (!env.elevenLabsApiKey || !agentId) {
    return json(503, { error: "Voice is not set up yet. Use \"Set up Kinly's voice\" on the family dashboard." });
  }
  const res = await env.fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
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
      await apply(env, id, [{ type: "confirmReminder", reminderId, date }]);
      return json(200, { ok: true, result: "Logged as taken. The family can see it." });
    }
    case "get_family_messages": {
      const unread = unreadFamilyMessages(household);
      if (unread.length) {
        await apply(env, id, [{ type: "markMessagesRead", ids: unread.map((m) => m.id) }]);
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
      await apply(env, id, [
        { type: "elderMessage", familyName: known?.name ?? (familyName || "Family"), text: text.slice(0, 1000) },
      ]);
      return json(200, { ok: true, result: `Message sent to ${known?.name ?? "the family"}.` });
    }
    case "raise_alert": {
      const reason = str("reason") || "Asked for help during a conversation.";
      await apply(env, id, [{ type: "raiseAlert", source: "voice", reason: reason.slice(0, 500) }]);
      return json(200, {
        ok: true,
        result: "The family has been alerted. Stay with the person and reassure them.",
      });
    }
    default:
      return json(404, { error: `Unknown tool "${name}".` });
  }
}

/**
 * Scheduled check (every few minutes, see .github/workflows/reminders.yml):
 * logs unconfirmed medicines and meals as missed and alerts the family, even
 * when the elder's tablet is off. Needs no secret: it only does what is due
 * anyway, is safe to repeat, and returns counts, never household data.
 */
export async function handleReminderCheck(env: ServerEnv, req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "Method not allowed." });
  if (!env.store) return json(503, { error: "Cloud storage is not configured." });
  const now = new Date();
  let checked = 0;
  let missed = 0;
  let failed = 0;
  for (const id of await env.store.listIds()) {
    checked++;
    try {
      const row = await env.store.load(id);
      if (!row) continue;
      const overdue = overdueReminders(row.household, now);
      if (!overdue.length) continue;
      // markMissed is a no-op if the reminder was confirmed in the meantime.
      await apply(
        env,
        id,
        overdue.map((t) => ({ type: "markMissed" as const, reminderId: t.reminder.id, date: t.date })),
      );
      missed += overdue.length;
    } catch (e) {
      console.error("reminder check failed for a household", e);
      failed++;
    }
  }
  return json(200, { checked, missed, failed });
}
