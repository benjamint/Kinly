import { beforeEach, describe, expect, it } from "vitest";
import { handleConfig, handleHousehold, handleSession, handleSetupVoice, resetAgentCache, type ApiRequest, type ServerEnv } from "../server/handlers";
import { MemoryStore, sha256 } from "../server/store";
import { demoHousehold } from "../src/shared/household";

// A tiny fake of the ElevenLabs agents/tools API.
function fakeElevenLabs() {
  const tools: { id: string; tool_config: { name: string; api_schema: { url: string } } }[] = [];
  const agents: { agent_id: string; name: string; body: unknown }[] = [];
  const calls: string[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const ok = (data: unknown) => new Response(JSON.stringify(data));
    if (u.pathname === "/v1/convai/tools" && method === "GET") return ok({ tools });
    if (u.pathname === "/v1/convai/tools" && method === "POST") {
      const t = { id: `tool-${tools.length}`, tool_config: body.tool_config };
      tools.push(t);
      return ok({ id: t.id });
    }
    if (u.pathname.startsWith("/v1/convai/tools/") && method === "PATCH") return ok({});
    if (u.pathname === "/v1/convai/agents" && method === "GET") return ok({ agents });
    if (u.pathname === "/v1/convai/agents/create") {
      agents.push({ agent_id: "agent-1", name: body.name, body });
      return ok({ agent_id: "agent-1" });
    }
    if (u.pathname.startsWith("/v1/convai/agents/") && method === "PATCH") return ok({});
    if (u.pathname === "/v1/convai/conversation/token") return ok({ token: `tok-for-${u.searchParams.get("agent_id")}` });
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, tools, agents, calls };
}

const auth = { query: { id: "ama" }, headers: { "x-kinly-pin": "123456", host: "kinly.example.app" } };
const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({ method: "GET", ...auth, body: undefined, ...over });

let env: ServerEnv;
let el: ReturnType<typeof fakeElevenLabs>;

beforeEach(async () => {
  resetAgentCache();
  el = fakeElevenLabs();
  const store = new MemoryStore();
  await store.create(demoHousehold("ama", "Africa/Accra"), await sha256("ama:123456"));
  env = { store, elevenLabsApiKey: "xi", toolSecret: "s3cret", fetch: el.fetch };
});

describe("voice setup from the dashboard", () => {
  it("offers setup when the key is set but no agent exists", async () => {
    expect((await handleConfig(env)).body).toMatchObject({ voice: false, voiceSetupAvailable: true });
  });

  it("creates the tools pointing at this site, then the agent", async () => {
    const res = await handleSetupVoice(env, req({ method: "POST" }));
    expect(res.body).toEqual({ agentId: "agent-1", created: true });
    expect(el.tools.map((t) => t.tool_config.name)).toEqual([
      "get_reminders", "confirm_reminder", "get_family_messages", "send_family_message", "raise_alert",
    ]);
    expect(el.tools[0].tool_config.api_schema.url).toBe("https://kinly.example.app/api/tools/get_reminders");
    expect((await handleConfig(env)).body).toMatchObject({ voice: true, voiceSetupAvailable: false });
  });

  it("updates instead of duplicating when run twice", async () => {
    await handleSetupVoice(env, req({ method: "POST" }));
    resetAgentCache();
    const again = await handleSetupVoice(env, req({ method: "POST" }));
    expect(again.body).toEqual({ agentId: "agent-1", created: false });
    expect(el.tools).toHaveLength(5);
    expect(el.agents).toHaveLength(1);
  });

  it("requires the household PIN", async () => {
    const res = await handleSetupVoice(env, req({ method: "POST", headers: { host: "x", "x-kinly-pin": "000000" } }));
    expect(res.status).toBe(401);
    expect(el.calls).toEqual([]);
  });

  it("finds the agent by name for voice sessions (no agent id to copy)", async () => {
    expect((await handleSession(env, req())).status).toBe(503);
    await handleSetupVoice(env, req({ method: "POST" }));
    const res = await handleSession(env, req());
    expect(res.body).toMatchObject({ token: "tok-for-agent-1" });
  });
});

describe("agent config", () => {
  it("uses an English-compatible voice model by default", async () => {
    await handleSetupVoice(env, req({ method: "POST" }));
    const body = el.agents[0].body as { conversation_config: { tts: { model_id: string } } };
    expect(body.conversation_config.tts.model_id).toBe("eleven_flash_v2");
  });
});

describe("daily voice limit", () => {
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(new Date());
  const capHousehold = async (minutes: number, usedSeconds: number) => {
    const row = (await env.store!.load("ama"))!;
    const h = { ...row.household, elder: { ...row.household.elder, voiceMinutesPerDay: minutes }, voiceUsage: { [today()]: usedSeconds } };
    await env.store!.save("ama", h, row.version);
  };

  it("refuses chat once today's minutes are used, but never Help or reminders", async () => {
    await handleSetupVoice(env, req({ method: "POST" }));
    await capHousehold(10, 600);
    const chat = await handleSession(env, req({ query: { id: "ama", purpose: "chat" } }));
    expect(chat.status).toBe(429);
    expect(chat.body).toMatchObject({ code: "voice_cap" });
    expect((await handleSession(env, req({ query: { id: "ama", purpose: "help" } }))).status).toBe(200);
    expect((await handleSession(env, req({ query: { id: "ama", purpose: "reminder" } }))).status).toBe(200);
  });

  it("tells the screen how many chat minutes are left", async () => {
    await handleSetupVoice(env, req({ method: "POST" }));
    await capHousehold(10, 240);
    const res = await handleSession(env, req({ query: { id: "ama", purpose: "chat" } }));
    expect(res.body).toMatchObject({ minutesLeft: 6 });
  });

  it("lets the screen record new activity, event and usage actions", async () => {
    const res = await handleHousehold(env, req({
      method: "POST",
      body: { actions: [
        { type: "logActivity", result: { game: "pairs", seconds: 120, score: 1, level: 1 } },
        { type: "saveEvent", event: { id: "e1", date: "2030-01-01", text: "Party" } },
        { type: "logVoiceUsage", date: today(), seconds: 30 },
      ] },
    }));
    expect(res.status).toBe(200);
  });
});
