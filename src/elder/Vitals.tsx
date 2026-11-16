import type { CSSProperties, ReactNode } from "react";
import type { Household } from "../shared/types";
import { simulateVitals, utcOffsetMinutes, type Reading, type Vitals } from "../shared/vitals";

export function useVitals(household: Household, now: Date): Vitals {
  return simulateVitals(household.id, now, utcOffsetMinutes(household.elder.timezone, now));
}

const ICON: Record<string, ReactNode> = {
  heart: (
    <svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" /><path d="M5.5 12.5h3l1.5-2.5 2.5 5 1.5-2.5h4.5" /></svg>
  ),
  bp: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7" /><path d="M12 13l3.2-3.2M12 4V2.5M9.5 2.5h5" /></svg>
  ),
  sugar: (
    <svg viewBox="0 0 24 24"><path d="M12 3.5S6.5 10 6.5 14a5.5 5.5 0 0 0 11 0c0-4-5.5-10.5-5.5-10.5z" /><path d="M9.6 14.6a2.5 2.5 0 0 0 2.4 2.4" /></svg>
  ),
};

function Spark({ values, w = 64, h = 20 }: { values: number[]; w?: number; h?: number }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - lo) / span) * (h - 4)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.2" />
    </svg>
  );
}

interface Tile {
  key: "heart" | "bp" | "sugar";
  label: string;
  value: string;
  unit: string;
  ok: boolean;
  series: number[];
}

function tiles(v: Vitals, sw: boolean): Tile[] {
  const pick = (f: (r: Reading) => number) => v.history.map(f);
  return [
    { key: "heart", label: sw ? "Mapigo ya moyo" : "Heart rate", value: String(v.latest.heartRate), unit: "bpm", ok: v.status.heartRate === "normal", series: pick((r) => r.heartRate) },
    { key: "bp", label: sw ? "Shinikizo la damu" : "Blood pressure", value: `${v.latest.systolic}/${v.latest.diastolic}`, unit: "mmHg", ok: v.status.bp === "normal", series: pick((r) => r.systolic) },
    { key: "sugar", label: sw ? "Sukari" : "Blood sugar", value: v.latest.glucose.toFixed(1), unit: "mmol/L", ok: v.status.glucose === "normal", series: pick((r) => r.glucose) },
  ];
}

/** Three compact readings for the elder's screen. */
export function VitalsRow({ household, now, where }: { household: Household; now: Date; where: "side" | "stage" }) {
  const v = useVitals(household, now);
  const sw = household.elder.language === "sw";
  const beat = { "--beat": `${(60 / v.latest.heartRate).toFixed(2)}s` } as CSSProperties;
  return (
    <section className={`vitals vitals--${where}`} aria-label={sw ? "Vipimo vya afya (vya majaribio)" : "Health readings (simulated)"}>
      <div className="vitals__row">
        {tiles(v, sw).map((t) => (
          <div key={t.key} className={`vital vital--${t.key}`} style={t.key === "heart" ? beat : undefined}>
            <span className="vital__top">
              <span className="vital__icon" aria-hidden="true">{ICON[t.key]}</span>
              <span className="vital__label">{t.label}</span>
            </span>
            <span className="vital__value">
              {t.value} <small>{t.unit}</small>
            </span>
            <span className="vital__foot">
              <span className={`vital__dot${t.ok ? "" : " vital__dot--watch"}`} />
              <span className="vital__status">{t.ok ? (sw ? "Kawaida" : "Normal") : sw ? "Angalia" : "Check"}</span>
              <Spark values={t.series} />
            </span>
          </div>
        ))}
      </div>
      <p className="vitals__note">{sw ? "Vipimo vya majaribio, si kutoka kwa kifaa" : "Simulated readings · not from a device"}</p>
    </section>
  );
}

/** The same readings on the family dashboard, with a little more detail. */
export function VitalsCard({ household, now }: { household: Household; now: Date }) {
  const v = useVitals(household, now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: household.elder.timezone, hour: "2-digit", minute: "2-digit" });
  return (
    <section className="card vitals-card" aria-labelledby="vitals-h">
      <h2 id="vitals-h">
        Health readings <span className="pill">Simulated</span>
      </h2>
      <div className="vitals-card__grid">
        {tiles(v, false).map((t) => (
          <div key={t.key} className={`vital vital--${t.key} vital--wide`}>
            <span className="vital__top">
              <span className="vital__icon" aria-hidden="true">{ICON[t.key]}</span>
              <span className="vital__label">{t.label}</span>
            </span>
            <span className="vital__value">
              {t.value} <small>{t.unit}</small>
            </span>
            <Spark values={t.series} w={160} h={36} />
            <span className="vital__foot">
              <span className={`vital__dot${t.ok ? "" : " vital__dot--watch"}`} />
              <span className="vital__status">{t.ok ? "Normal" : "Check"}</span>
              <span className="muted">· last 3 hours</span>
            </span>
          </div>
        ))}
      </div>
      <p className="muted vitals-card__note">
        Demo data, not from a device. Last reading {time.format(new Date(v.latest.at))}. A real monitor can be connected in a
        later version.
      </p>
    </section>
  );
}
