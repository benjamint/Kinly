import { describe, expect, it } from "vitest";
import { handleReminderCheck, type ServerEnv } from "../server/handlers";
import type { PushPayload } from "../server/push";
import { MemoryStore, sha256 } from "../server/store";
import { applyAction, demoHousehold } from "../src/shared/household";
import type { Household } from "../src/shared/types";

// The check runs at "now", so build reminders relative to the current time in UTC
// (Africa/Accra is UTC+0 with no daylight saving).
function hhmm(minutesAgo: number) {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

async function setup() {
  const store = new MemoryStore();
  let h: Household = { ...demoHousehold("ama", "Africa/Accra"), createdAt: new Date(Date.now() - 6 * 3600_000).toISOString(), reminders: [] };
  h = applyAction(h, { type: "saveReminder", reminder: { id: "late-med", kind: "medication", label: "heart tablet", time: hhmm(45), active: true } });
  h = applyAction(h, { type: "saveReminder", reminder: { id: "recent-med", kind: "medication", label: "eye drops", time: hhmm(10), active: true } });
  h = { ...h, push: [{ endpoint: "https://push.example/esi", keys: { p256dh: "k", auth: "a" }, familyName: "Esi", createdAt: "" }] };
  await store.create(h, await sha256("ama:123456"));
  const sent: PushPayload[] = [];
  const env: ServerEnv = { store, toolSecret: "s", fetch, pushSender: async (_s, p) => (sent.push(p), "ok") };
  return { store, env, sent };
}

const run = (env: ServerEnv) => handleReminderCheck(env, { method: "POST", query: {}, headers: {}, body: undefined });

describe("server reminder check", () => {
  // Skip in the few minutes around UTC midnight, where "45 minutes ago" is yesterday.
  const nearMidnight = new Date().getUTCHours() === 0 && new Date().getUTCMinutes() < 50;

  it.skipIf(nearMidnight)("logs overdue medicine as missed and alerts the family, once", async () => {
    const { store, env, sent } = await setup();
    expect((await run(env)).body).toEqual({ checked: 1, missed: 1, failed: 0 });
    const h = (await store.load("ama"))!.household;
    expect(h.logs.map((l) => [l.reminderId, l.status])).toEqual([["late-med", "missed"]]);
    expect(sent.map((p) => p.title)).toEqual(["Ama missed a medicine"]);

    // Running again (the schedule repeats every 5 minutes) changes nothing.
    expect((await run(env)).body).toMatchObject({ missed: 0 });
    expect(sent).toHaveLength(1);
  });

  it.skipIf(nearMidnight)("leaves confirmed reminders alone", async () => {
    const { store, env, sent } = await setup();
    const row = (await store.load("ama"))!;
    const date = new Date().toISOString().slice(0, 10);
    await store.save("ama", applyAction(row.household, { type: "confirmReminder", reminderId: "late-med", date }), row.version);
    expect((await run(env)).body).toMatchObject({ missed: 0 });
    expect(sent).toEqual([]);
  });

  it("reveals nothing about households", async () => {
    const { env } = await setup();
    expect(Object.keys((await run(env)).body as object).sort()).toEqual(["checked", "failed", "missed"]);
  });
});
