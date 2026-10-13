import { describe, expect, it } from "vitest";
import { respond } from "../src/lib/demo-brain";
import { demoHousehold } from "../src/shared/household";

const h = demoHousehold("t", "Africa/Accra");
const now = new Date("2026-10-13T08:05:00Z");

describe("demo brain", () => {
  it("escalates distress before anything else", () => {
    const r = respond(h, "yes but I fell and my hip hurts", { reminderId: "r-bp" }, now);
    expect(r.actions[0]).toMatchObject({ type: "raiseAlert", source: "voice" });
    expect(r.say).toMatch(/Esi and Kofi/);
  });

  it("confirms the reminder it asked about", () => {
    const r = respond(h, "Yes I've taken it", { reminderId: "r-bp" }, now);
    expect(r.actions).toEqual([{ type: "confirmReminder", reminderId: "r-bp", date: "2026-10-13" }]);
  });

  it("does not confirm on a no", () => {
    const r = respond(h, "not yet", { reminderId: "r-bp" }, now);
    expect(r.actions).toEqual([]);
  });

  it("relays a spoken message to a named family member", () => {
    const r = respond(h, "tell Esi that I miss the children", {}, now);
    expect(r.actions).toEqual([{ type: "elderMessage", familyName: "Esi", text: "I miss the children" }]);
  });

  it("asks who, then what, then sends", () => {
    const who = respond(h, "Kofi please", { askingWho: true }, now);
    expect(who.context).toEqual({ composingTo: "Kofi" });
    const sent = respond(h, "Bring bread when you come", who.context, now);
    expect(sent.actions).toEqual([{ type: "elderMessage", familyName: "Kofi", text: "Bring bread when you come" }]);
  });

  it("reads unread family messages and marks them heard", () => {
    const r = respond(h, "any messages?", {}, now);
    expect(r.say).toMatch(/Esi says/);
    expect(r.actions[0]).toMatchObject({ type: "markMessagesRead" });
  });

  it("understands Kiswahili for help", () => {
    const r = respond(h, "msaada tafadhali", {}, now);
    expect(r.actions[0]).toMatchObject({ type: "raiseAlert" });
  });
});
