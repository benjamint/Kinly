import { describe, expect, it } from "vitest";
import {
  EXERCISES,
  PROVERBS,
  currencyFor,
  drumNext,
  drumStart,
  levelFor,
  mathsRound,
  pairsDeck,
  pairsScore,
  proverbRound,
} from "../src/shared/activities";
import { applyAction, demoHousehold, upcomingEvents, voiceMinutesLeft } from "../src/shared/household";
import type { ActivityResult } from "../src/shared/types";

// Deterministic random numbers for repeatable tests.
function seeded(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

const result = (score: number, level: number): ActivityResult => ({ id: "x", game: "pairs", at: "", seconds: 60, score, level });

describe("difficulty", () => {
  it("starts at level 1, steps up after doing well and down after a struggle", () => {
    expect(levelFor("pairs", [])).toBe(1);
    expect(levelFor("pairs", [result(1, 1), result(0.9, 1)])).toBe(2);
    expect(levelFor("pairs", [result(1, 3), result(1, 3), result(1, 3)])).toBe(3);
    expect(levelFor("pairs", [result(0.2, 2)])).toBe(1);
    expect(levelFor("pairs", [result(0.6, 2)])).toBe(2);
    expect(levelFor("drums", [result(1, 3)])).toBe(1); // other games don't count
  });
});

describe("matching pairs", () => {
  it("deals 3, 4 or 6 pairs and every card has its twin", () => {
    for (const [level, cards] of [[1, 6], [2, 8], [3, 12]]) {
      const deck = pairsDeck(level, seeded(level));
      expect(deck).toHaveLength(cards);
      const counts = new Map<string, number>();
      deck.forEach((c) => counts.set(c.item.id, (counts.get(c.item.id) ?? 0) + 1));
      expect([...counts.values()].every((n) => n === 2)).toBe(true);
    }
  });

  it("scores perfect play as 1 and extra tries lower", () => {
    expect(pairsScore(4, 4)).toBe(1);
    expect(pairsScore(4, 8)).toBe(0.5);
  });
});

describe("proverbs", () => {
  it("offers the right ending plus two others, in the elder's language", () => {
    for (const lang of ["en", "sw"] as const) {
      const r = proverbRound(lang, seeded(7));
      expect(r.proverb.lang).toBe(lang);
      expect(r.choices).toHaveLength(3);
      expect(new Set(r.choices).size).toBe(3);
      expect(r.choices).toContain(r.proverb.end);
    }
  });

  it("avoids proverbs used recently", () => {
    const avoid = PROVERBS.filter((p) => p.lang === "en").slice(1).map((p) => p.start);
    expect(proverbRound("en", seeded(3), avoid).proverb.start).toBe(PROVERBS[0].start);
  });
});

describe("market maths", () => {
  it("always includes the right answer among three positive choices", () => {
    for (let i = 0; i < 200; i++) {
      for (const level of [1, 2, 3]) {
        const r = mathsRound(level, "cedis", seeded(i * 3 + level));
        expect(r.choices).toContain(r.answer);
        expect(new Set(r.choices).size).toBe(3);
        expect(r.choices.every((n) => n > 0)).toBe(true);
        expect(r.question).toContain("cedis");
      }
    }
  });

  it("works out change correctly at level 3", () => {
    const r = mathsRound(3, "cedis", seeded(5));
    const [price, note] = [...r.question.matchAll(/(\d+) cedis/g)].map((m) => Number(m[1]));
    expect(r.answer).toBe(note - price);
  });

  it("picks the local money word from the time zone unless set", () => {
    expect(currencyFor(demoHousehold("t", "Africa/Accra"))).toBe("cedis");
    expect(currencyFor(demoHousehold("t", "Africa/Nairobi"))).toBe("shillings");
    const h = demoHousehold("t", "Africa/Accra");
    expect(currencyFor({ ...h, elder: { ...h.elder, currency: "naira" } })).toBe("naira");
  });
});

describe("drum memory", () => {
  it("starts longer at higher levels and grows by one beat", () => {
    expect(drumStart(1, seeded())).toHaveLength(2);
    expect(drumStart(3, seeded())).toHaveLength(4);
    const s = drumStart(1, seeded());
    const next = drumNext(s, seeded(9));
    expect(next.slice(0, s.length)).toEqual(s);
    expect(next).toHaveLength(s.length + 1);
    expect(next.every((d) => d >= 0 && d < 4)).toBe(true);
  });
});

describe("exercises", () => {
  it("are all gentle, with both languages filled in", () => {
    for (const e of EXERCISES) {
      expect(e.title.en && e.title.sw && e.how.en && e.how.sw).toBeTruthy();
      expect(e.reps * e.secondsEach).toBeLessThanOrEqual(60);
    }
  });
});

describe("household: activities, events and voice usage", () => {
  const tz = "Africa/Accra";
  const now = new Date("2026-10-13T10:00:00Z");

  it("logs activities with clamped values", () => {
    const h = applyAction(demoHousehold("t", tz), { type: "logActivity", result: { game: "maths", seconds: 99999, score: 3, level: 9 } });
    expect(h.activityLog![0]).toMatchObject({ game: "maths", seconds: 3600, score: 1, level: 3 });
  });

  it("keeps upcoming events in date order and drops past ones from the board", () => {
    let h = demoHousehold("t", tz);
    h = applyAction(h, { type: "saveEvent", event: { id: "b", date: "2026-10-18", text: "Esi visits" } });
    h = applyAction(h, { type: "saveEvent", event: { id: "a", date: "2026-10-14", text: "Doctor" } });
    h = applyAction(h, { type: "saveEvent", event: { id: "old", date: "2026-10-01", text: "Past" } });
    expect(upcomingEvents(h, now).map((e) => e.id)).toEqual(["a", "b"]);
    h = applyAction(h, { type: "deleteEvent", eventId: "a" });
    expect(upcomingEvents(h, now).map((e) => e.id)).toEqual(["b"]);
  });

  it("adds up voice usage per day and reports minutes left under a limit", () => {
    let h = demoHousehold("t", tz);
    expect(voiceMinutesLeft(h, now)).toBeNull(); // no limit set
    h = applyAction(h, { type: "updateElder", patch: { voiceMinutesPerDay: 10 } });
    h = applyAction(h, { type: "logVoiceUsage", date: "2026-10-13", seconds: 240 });
    h = applyAction(h, { type: "logVoiceUsage", date: "2026-10-13", seconds: 120 });
    expect(voiceMinutesLeft(h, now)).toBe(4);
    h = applyAction(h, { type: "logVoiceUsage", date: "2026-10-13", seconds: 600 });
    expect(voiceMinutesLeft(h, now)).toBe(0);
  });

  it("keeps only the last 14 days of usage", () => {
    let h = demoHousehold("t", tz);
    for (let d = 1; d <= 20; d++) h = applyAction(h, { type: "logVoiceUsage", date: `2026-10-${String(d).padStart(2, "0")}`, seconds: 60 });
    expect(Object.keys(h.voiceUsage!)).toHaveLength(14);
    expect(Object.keys(h.voiceUsage!)[0]).toBe("2026-10-07");
  });
});
