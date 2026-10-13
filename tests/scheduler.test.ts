import { describe, expect, it } from "vitest";
import { schedulerStep } from "../src/elder/useReminderScheduler";
import { applyAction, demoHousehold } from "../src/shared/household";

const h = { ...demoHousehold("t", "Africa/Accra"), createdAt: "2026-10-13T00:00:00Z" };
const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00Z`);

describe("reminder scheduler", () => {
  it("prompts a due reminder, waits, then re-asks", () => {
    const prompted = new Map<string, number>();
    expect(schedulerStep(h, at("07:59"), prompted).prompt).toBeNull();
    const first = schedulerStep(h, at("08:00"), prompted).prompt;
    expect(first).toEqual({ reminderId: "r-bp", date: "2026-10-13" });
    prompted.set("r-bp:2026-10-13", at("08:00").getTime());
    expect(schedulerStep(h, at("08:05"), prompted).prompt).toBeNull();
    expect(schedulerStep(h, at("08:10"), prompted).prompt?.reminderId).toBe("r-bp");
  });

  it("reports missed after the window and stops prompting", () => {
    const step = schedulerStep(h, at("08:31"), new Map());
    expect(step.missed).toEqual([{ reminderId: "r-bp", date: "2026-10-13" }]);
    expect(step.prompt).toBeNull();
  });

  it("stays quiet during quiet hours", () => {
    const late = applyAction(h, {
      type: "saveReminder",
      reminder: { id: "r-late", kind: "medication", label: "late pill", time: "22:00", active: true },
    });
    expect(schedulerStep(late, at("22:05"), new Map()).prompt?.reminderId).not.toBe("r-late");
  });
});

describe("new households", () => {
  it("don't report reminders that were due before setup as missed", () => {
    const fresh = { ...demoHousehold("t", "Africa/Accra"), createdAt: "2026-10-13T12:00:00Z" };
    expect(schedulerStep(fresh, new Date("2026-10-13T12:05:00Z"), new Map()).missed).toEqual([]);
    expect(schedulerStep(fresh, new Date("2026-10-13T19:31:00Z"), new Map()).missed.map((m) => m.reminderId)).toEqual(["r-lunch", "r-diabetes"]);
  });
});
