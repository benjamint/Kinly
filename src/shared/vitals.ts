// Simulated health readings (heart rate, blood pressure, blood sugar).
//
// There is no real monitor yet: these numbers are DEMO DATA, made up from
// the household id and the time so every screen shows the same values.
// They are never sent to the voice agent, so Kinly never talks about them.

export type VitalStatus = "normal" | "watch";

export interface Reading {
  at: string;
  heartRate: number;
  systolic: number;
  diastolic: number;
  /** mmol/L */
  glucose: number;
}

export interface Vitals {
  latest: Reading;
  /** Oldest first, ending with `latest`. */
  history: Reading[];
  status: { heartRate: VitalStatus; bp: VitalStatus; glucose: VitalStatus };
}

/** Outside these bands a reading is shown as "watch" (simple, non-medical demo bands). */
export const VITAL_BANDS = {
  heartRate: { low: 55, high: 95 },
  systolic: { low: 95, high: 135 },
  diastolic: { low: 60, high: 85 },
  glucose: { low: 4, high: 7.8 },
};

/** A reading is taken every this many minutes. */
export const READING_EVERY_MIN = 15;
const HISTORY = 12;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0–1 noise for a seed and an integer step. */
function rand(seed: number, n: number): number {
  let x = (seed ^ Math.imul(n, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise in -1…1 that changes over `period` steps. */
function smooth(seed: number, step: number, period: number): number {
  const p = step / period;
  const i = Math.floor(p);
  const f = p - i;
  const t = f * f * (3 - 2 * f);
  return (rand(seed, i) * (1 - t) + rand(seed, i + 1) * t) * 2 - 1;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The simulated reading for one 15-minute slot. `hourOfDay` is local time. */
function readingAt(seed: number, slot: number, hourOfDay: number): Reading {
  const afternoon = Math.max(0, Math.sin(((hourOfDay - 9) / 12) * Math.PI)); // 0 at night, 1 mid-afternoon
  // Gentle rise in sugar 1–2 hours after usual meal times.
  const meal = [8, 13, 19].reduce((m, h) => {
    const d = hourOfDay - h;
    return d > 0 && d < 3 ? Math.max(m, Math.sin((d / 3) * Math.PI)) : m;
  }, 0);
  const hr = 70 + afternoon * 5 + smooth(seed + 1, slot, 4) * 6 + (rand(seed + 2, slot) - 0.5) * 3;
  const sys = 124 + smooth(seed + 3, slot, 8) * 6 + afternoon * 2;
  const dia = 79 + smooth(seed + 4, slot, 8) * 4;
  const glu = 5.4 + meal * 1.3 + smooth(seed + 5, slot, 6) * 0.5;
  return {
    at: new Date(slot * READING_EVERY_MIN * 60_000).toISOString(),
    heartRate: Math.round(clamp(hr, 62, 84)),
    systolic: Math.round(clamp(sys, 118, 132)),
    diastolic: Math.round(clamp(dia, 74, 84)),
    glucose: Math.round(clamp(glu, 4.8, 7.2) * 10) / 10,
  };
}

/** Simulated readings for a household, as of `now`. `utcOffsetMin` is the local offset (minutes). */
export function simulateVitals(householdId: string, now: Date, utcOffsetMin = 0): Vitals {
  const seed = hash(householdId);
  const slotNow = Math.floor(now.getTime() / (READING_EVERY_MIN * 60_000));
  const history: Reading[] = [];
  for (let s = slotNow - HISTORY + 1; s <= slotNow; s++) {
    const local = new Date(s * READING_EVERY_MIN * 60_000 + utcOffsetMin * 60_000);
    history.push(readingAt(seed, s, local.getUTCHours() + local.getUTCMinutes() / 60));
  }
  const latest = history[history.length - 1];
  const B = VITAL_BANDS;
  const within = (v: number, b: { low: number; high: number }) => v >= b.low && v <= b.high;
  return {
    latest,
    history,
    status: {
      heartRate: within(latest.heartRate, B.heartRate) ? "normal" : "watch",
      bp: within(latest.systolic, B.systolic) && within(latest.diastolic, B.diastolic) ? "normal" : "watch",
      glucose: within(latest.glucose, B.glucose) ? "normal" : "watch",
    },
  };
}

/** Minutes the time zone is ahead of UTC at `now` (e.g. Nairobi = 180). */
export function utcOffsetMinutes(timeZone: string, now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return Math.round((asUtc - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
  } catch {
    return 0;
  }
}
