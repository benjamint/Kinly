import { beforeEach, describe, expect, it } from "vitest";
import { handleHousehold, handleSession, handleTool, type ApiRequest, type ServerEnv } from "../server/handlers";
import { MemoryStore, sha256 } from "../server/store";
import { demoHousehold } from "../src/shared/household";
import type { Household } from "../src/shared/types";

const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({ method: "GET", query: {}, headers: {}, body: undefined, ...over });

let store: MemoryStore;
let env: ServerEnv;

beforeEach(async () => {
  store = new MemoryStore();
  await store.create(demoHousehold("ama", "Africa/Accra"), await sha256("ama:123456"));
  env = {
    store,
    toolSecret: "s3cret",
    elevenLabsApiKey: "xi",
    elevenLabsAgentId: "agent",
    fetch: (async () => new Response(JSON.stringify({ token: "tok" }))) as typeof fetch,
  };
});

const tool = (name: string, body: object, secret = "s3cret") =>
  handleTool(env, name, req({ method: "POST", headers: { "x-kinly-tool-secret": secret }, body: { household_id: "ama", ...body } }));

describe("household API", () => {
  it("rejects a wrong PIN", async () => {
    const res = await handleHousehold(env, req({ query: { id: "ama" }, headers: { "x-kinly-pin": "000000" } }));
    expect(res.status).toBe(401);
  });

  it("applies allowed actions and rejects unknown ones", async () => {
    const auth = { query: { id: "ama" }, headers: { "x-kinly-pin": "123456" } };
    const ok = await handleHousehold(env, req({ ...auth, method: "POST", body: { actions: [{ type: "familyMessage", familyName: "Esi", text: "Hi" }] } }));
    expect(ok.status).toBe(200);
    expect((ok.body as Household).messages.at(-1)?.text).toBe("Hi");
    const bad = await handleHousehold(env, req({ ...auth, method: "POST", body: { actions: [{ type: "dropTables" }] } }));
    expect(bad.status).toBe(400);
  });

  it("mints a voice session with the household context", async () => {
    const res = await handleSession(env, req({ query: { id: "ama" }, headers: { "x-kinly-pin": "123456" } }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token: "tok", dynamicVariables: { household_id: "ama", elder_name: "Ama" } });
  });
});

describe("agent tools", () => {
  it("require the shared secret", async () => {
    expect((await tool("get_reminders", {}, "wrong")).status).toBe(401);
  });

  it("confirm a reminder by voice", async () => {
    const res = await tool("confirm_reminder", { reminder_id: "r-bp" });
    expect(res.body).toMatchObject({ ok: true });
    const row = await store.load("ama");
    expect(row?.household.logs[0]).toMatchObject({ reminderId: "r-bp", status: "taken" });
  });

  it("refuse to confirm a reminder that doesn't exist", async () => {
    const res = await tool("confirm_reminder", { reminder_id: "made-up" });
    expect(res.body).toMatchObject({ ok: false });
  });

  it("read family messages once", async () => {
    const first = (await tool("get_family_messages", {})).body as { messages: unknown[] };
    const second = (await tool("get_family_messages", {})).body as { messages: unknown[] };
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(0);
  });

  it("send a spoken message and raise an alert", async () => {
    await tool("send_family_message", { family_name: "esi", message: "Call me tonight" });
    await tool("raise_alert", { reason: "Said she fell" });
    const h = (await store.load("ama"))!.household;
    expect(h.messages.at(-1)).toMatchObject({ direction: "elder", familyName: "Esi", text: "Call me tonight" });
    expect(h.alerts.at(-1)).toMatchObject({ source: "voice", reason: "Said she fell" });
  });
});
