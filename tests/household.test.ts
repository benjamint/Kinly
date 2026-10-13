import { describe, expect, it } from "vitest";
import { applyAction, demoHousehold, isQuietTime, localClock, overdueReminders, todaysReminders } from "../src/shared/household";
import type { Household } from "../src/shared/types";

const TZ = "Africa/Accra"; // UTC+0, no DST: local time == UTC
const mk = (): Household => ({ ...demoHousehold("t", TZ), createdAt: "2026-10-13T00:00:00Z" });
const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00Z`);

describe("household", () => {
  it("reads local time in the elder's time zone", () => {
    expect(localClock(at("23:30"), "Africa/Nairobi")).toEqual({ date: "2026-10-14", minutes: 150 });
  });

  it("marks reminders upcoming, due, then taken", () => {
    let h = mk();
    expect(todaysReminders(h, at("07:00")).find((t) => t.reminder.id === "r-bp")?.status).toBe("upcoming");
    expect(todaysReminders(h, at("08:05")).find((t) => t.reminder.id === "r-bp")?.status).toBe("due");
    h = applyAction(h, { type: "confirmReminder", reminderId: "r-bp", date: "2026-10-13" }, at("08:06"));
    expect(todaysReminders(h, at("08:10")).find((t) => t.reminder.id === "r-bp")?.status).toBe("taken");
  });

  it("flags overdue reminders after 30 minutes", () => {
    const h = mk();
    expect(overdueReminders(h, at("08:29"))).toHaveLength(0);
    expect(overdueReminders(h, at("08:30")).map((t) => t.reminder.id)).toEqual(["r-bp"]);
  });

  it("alerts family on a missed medication but never overwrites a confirmation", () => {
    let h = mk();
    h = applyAction(h, { type: "markMissed", reminderId: "r-bp", date: "2026-10-13" });
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].source).toBe("missed");

    let h2 = mk();
    h2 = applyAction(h2, { type: "confirmReminder", reminderId: "r-bp", date: "2026-10-13" });
    h2 = applyAction(h2, { type: "markMissed", reminderId: "r-bp", date: "2026-10-13" });
    expect(h2.logs.map((l) => l.status)).toEqual(["taken"]);
    expect(h2.alerts).toHaveLength(0);
  });

  it("does not alert for a missed meal", () => {
    const h = applyAction(mk(), { type: "markMissed", reminderId: "r-lunch", date: "2026-10-13" });
    expect(h.alerts).toHaveLength(0);
    expect(h.logs[0].status).toBe("missed");
  });

  it("handles quiet hours that wrap past midnight", () => {
    const h = mk(); // 21:30 – 06:30
    expect(isQuietTime(h, at("23:00"))).toBe(true);
    expect(isQuietTime(h, at("05:00"))).toBe(true);
    expect(isQuietTime(h, at("12:00"))).toBe(false);
  });

  it("acknowledges an alert once", () => {
    let h = applyAction(mk(), { type: "raiseAlert", source: "button", reason: "help" });
    const id = h.alerts[0].id;
    h = applyAction(h, { type: "acknowledgeAlert", alertId: id, by: "Esi" });
    h = applyAction(h, { type: "acknowledgeAlert", alertId: id, by: "Kofi" });
    expect(h.alerts[0].acknowledgedBy).toBe("Esi");
  });
});
