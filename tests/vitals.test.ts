import { describe, expect, it } from "vitest";
import { simulateVitals, utcOffsetMinutes, VITAL_BANDS } from "../src/shared/vitals";

describe("simulated vitals", () => {
  const now = new Date("2026-11-16T14:20:00Z");

  it("is the same for the same household and time", () => {
    expect(simulateVitals("demo", now)).toEqual(simulateVitals("demo", now));
  });

  it("differs between households", () => {
    const a = simulateVitals("demo", now).history.map((r) => r.heartRate).join();
    const b = simulateVitals("other-house", now).history.map((r) => r.heartRate).join();
    expect(a).not.toEqual(b);
  });

  it("keeps 12 readings, oldest first, all in a calm range", () => {
    for (let h = 0; h < 48; h++) {
      const v = simulateVitals("demo", new Date(now.getTime() + h * 37 * 60_000), 180);
      expect(v.history).toHaveLength(12);
      expect(v.history.at(-1)).toEqual(v.latest);
      expect(new Date(v.history[0].at) < new Date(v.latest.at)).toBe(true);
      for (const r of v.history) {
        expect(r.heartRate).toBeGreaterThanOrEqual(62);
        expect(r.heartRate).toBeLessThanOrEqual(84);
        expect(r.systolic).toBeGreaterThanOrEqual(118);
        expect(r.systolic).toBeLessThanOrEqual(132);
        expect(r.diastolic).toBeGreaterThanOrEqual(74);
        expect(r.diastolic).toBeLessThanOrEqual(84);
        expect(r.glucose).toBeGreaterThanOrEqual(4.8);
        expect(r.glucose).toBeLessThanOrEqual(7.2);
      }
      // The simulated ranges sit inside the "normal" bands.
      expect(v.status).toEqual({ heartRate: "normal", bp: "normal", glucose: "normal" });
    }
  });

  it("bands are sane", () => {
    expect(VITAL_BANDS.heartRate.low).toBeLessThan(VITAL_BANDS.heartRate.high);
  });

  it("works out time-zone offsets", () => {
    expect(utcOffsetMinutes("Africa/Nairobi", now)).toBe(180);
    expect(utcOffsetMinutes("Africa/Accra", now)).toBe(0);
    expect(utcOffsetMinutes("Not/AZone", now)).toBe(0);
  });
});
