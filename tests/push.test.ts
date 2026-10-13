import webpush from "web-push";
import { beforeEach, describe, expect, it } from "vitest";
import { handleConfig, handleHousehold, handlePush, handlePushAck, handleTool, type ApiRequest, type ServerEnv } from "../server/handlers";
import { ackToken, vapidKeys, type PushPayload, type PushRecord, type PushResult } from "../server/push";
import { MemoryStore, sha256 } from "../server/store";
import { demoHousehold } from "../src/shared/household";
import type { Household } from "../src/shared/types";

const SECRET = "s3cret";
const sub = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "BPk", auth: "au" } });
const auth = { query: { id: "ama" }, headers: { "x-kinly-pin": "123456" } };
const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({ method: "POST", ...auth, body: undefined, ...over });

let store: MemoryStore;
let env: ServerEnv;
let sent: { to: string; payload: PushPayload }[];
let responses: Record<string, PushResult>;

beforeEach(async () => {
  store = new MemoryStore();
  await store.create(demoHousehold("ama", "Africa/Accra"), await sha256("ama:123456"));
  sent = [];
  responses = {};
  env = {
    store,
    toolSecret: SECRET,
    fetch: globalThis.fetch,
    pushSender: async (s: PushRecord, payload: PushPayload) => {
      sent.push({ to: `${s.familyName}@${s.endpoint}`, payload });
      return responses[s.endpoint] ?? "ok";
    },
  };
});

const subscribe = (name: string, who: string) =>
  handlePush(env, req({ body: { action: "subscribe", subscription: sub(name), familyName: who } }));

describe("VAPID keys", () => {
  it("are derived deterministically and accepted by web-push", () => {
    const a = vapidKeys(SECRET);
    expect(vapidKeys(SECRET)).toEqual(a);
    expect(vapidKeys("other")).not.toEqual(a);
    expect(() => webpush.setVapidDetails("mailto:a@b.c", a.publicKey, a.privateKey)).not.toThrow();
  });

  it("are offered to browsers via /api/config", async () => {
    expect((await handleConfig(env)).body).toMatchObject({ pushPublicKey: vapidKeys(SECRET).publicKey });
  });
});

describe("push alerts", () => {
  it("never expose subscriptions to browsers", async () => {
    await subscribe("esi", "Esi");
    const res = await handleHousehold(env, req({ method: "GET" }));
    expect((res.body as Household).push).toBeUndefined();
    expect((await store.load("ama"))!.household.push).toHaveLength(1);
  });

  it("send the Help button alert to every phone, with a signed 'I'm on it'", async () => {
    await subscribe("esi", "Esi");
    await subscribe("kofi", "Kofi");
    await handleHousehold(env, req({ body: { actions: [{ type: "raiseAlert", source: "button", reason: "Pressed the Help button." }] } }));
    expect(sent.map((s) => s.to).sort()).toEqual(["Esi@https://push.example/esi", "Kofi@https://push.example/kofi"]);
    const esi = sent.find((s) => s.to.startsWith("Esi"))!.payload;
    expect(esi).toMatchObject({ title: "Ama needs help", urgent: true, ack: { householdId: "ama", by: "Esi" } });
    expect(esi.ack!.token).toBe(ackToken(SECRET, "ama", esi.ack!.alertId, "Esi"));
  });

  it("alerts when the voice agent raises an alert", async () => {
    await subscribe("esi", "Esi");
    await handleTool(env, "raise_alert", req({ headers: { "x-kinly-tool-secret": SECRET }, body: { household_id: "ama", reason: "Said she fell" } }));
    expect(sent[0].payload).toMatchObject({ title: "Ama needs help", body: "Said she fell" });
  });

  it("alerts on a missed medicine", async () => {
    await subscribe("esi", "Esi");
    await handleHousehold(env, req({ body: { actions: [{ type: "markMissed", reminderId: "r-bp", date: "2026-10-13" }] } }));
    expect(sent[0].payload.title).toBe("Ama missed a medicine");
  });

  it("'I'm on it' from the notification acknowledges and tells the others", async () => {
    await subscribe("esi", "Esi");
    await subscribe("kofi", "Kofi");
    await handleHousehold(env, req({ body: { actions: [{ type: "raiseAlert", source: "button", reason: "help" }] } }));
    const { ack } = sent.find((s) => s.to.startsWith("Esi"))!.payload;
    sent = [];
    expect((await handlePushAck(env, req({ query: {}, headers: {}, body: ack }))).status).toBe(200);
    expect((await store.load("ama"))!.household.alerts[0].acknowledgedBy).toBe("Esi");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "Kofi@https://push.example/kofi", payload: { title: "Esi is on it" } });
  });

  it("reject a forged 'I'm on it'", async () => {
    await handleHousehold(env, req({ body: { actions: [{ type: "raiseAlert", source: "button", reason: "help" }] } }));
    const alertId = (await store.load("ama"))!.household.alerts[0].id;
    const forged = { householdId: "ama", alertId, by: "Kofi", token: ackToken(SECRET, "ama", alertId, "Esi") };
    expect((await handlePushAck(env, req({ query: {}, headers: {}, body: forged }))).status).toBe(401);
  });

  it("deliver Ama's spoken message to the person it's for", async () => {
    await subscribe("esi", "Esi");
    await subscribe("kofi", "Kofi");
    await handleTool(env, "send_family_message", req({ headers: { "x-kinly-tool-secret": SECRET }, body: { household_id: "ama", family_name: "Kofi", message: "Bring bread" } }));
    expect(sent.map((s) => s.to)).toEqual(["Kofi@https://push.example/kofi"]);
    expect(sent[0].payload).toMatchObject({ title: "Message from Ama", body: "Bring bread" });
  });

  it("forget phones whose subscription is gone", async () => {
    await subscribe("esi", "Esi");
    await subscribe("old", "Kofi");
    responses["https://push.example/old"] = "gone";
    await handleHousehold(env, req({ body: { actions: [{ type: "raiseAlert", source: "button", reason: "help" }] } }));
    expect((await store.load("ama"))!.household.push!.map((p) => p.familyName)).toEqual(["Esi"]);
  });

  it("re-subscribing the same phone replaces it instead of duplicating", async () => {
    await subscribe("esi", "Esi");
    await subscribe("esi", "Kofi");
    expect((await store.load("ama"))!.household.push!.map((p) => p.familyName)).toEqual(["Kofi"]);
  });

  it("require the household PIN to subscribe", async () => {
    const res = await handlePush(env, req({ headers: { "x-kinly-pin": "000000" }, body: { action: "subscribe", subscription: sub("x"), familyName: "X" } }));
    expect(res.status).toBe(401);
  });
});
