import { useState } from "react";
import type { useHousehold } from "../lib/household-context";
import { currencyFor } from "../shared/activities";
import { localClock, newId, upcomingEvents, voiceMinutesLeft } from "../shared/household";
import type { Game, Household } from "../shared/types";

type Dispatch = ReturnType<typeof useHousehold>["dispatch"];

const GAME_NAMES: Record<Game, string> = {
  today: "Today board",
  pairs: "Matching pairs",
  proverbs: "Finish the proverb",
  drums: "Drum memory",
  maths: "Market maths",
  exercises: "Chair exercises",
};

/** Things the family wants on the elder's Today board ("Esi visits on Sunday"). */
export function ComingUpCard({ household, dispatch }: { household: Household; dispatch: Dispatch }) {
  const today = localClock(new Date(), household.elder.timezone).date;
  const [date, setDate] = useState(today);
  const [text, setText] = useState("");
  const events = upcomingEvents(household, new Date(), 60);
  return (
    <section className="card" aria-labelledby="coming-h">
      <h2 id="coming-h">Coming up</h2>
      <p className="muted">Shown on {household.elder.name}'s Today board and read aloud on request.</p>
      <ul className="list">
        {events.length === 0 && <li className="muted">Nothing yet.</li>}
        {events.map((e) => (
          <li key={e.id} className="row">
            <span className="mono">
              {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
                new Date(`${e.date}T12:00:00Z`),
              )}
            </span>
            <span className="grow">{e.text}</span>
            <button className="btn" onClick={() => void dispatch({ type: "deleteEvent", eventId: e.id })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="form form--inline"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!text.trim()) return;
          void dispatch({ type: "saveEvent", event: { id: newId(), date, text } });
          setText("");
        }}
      >
        <label>
          Date
          <input type="date" value={date} min={today} onChange={(ev) => setDate(ev.target.value)} required />
        </label>
        <label>
          What's happening
          <input value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Esi visits with the children" maxLength={200} />
        </label>
        <button className="btn btn--primary">Add</button>
      </form>
    </section>
  );
}

/** What the elder played this week: shows what they enjoy, and gentle changes over time. */
export function ActivitiesCard({ household }: { household: Household }) {
  const since = Date.now() - 7 * 86_400_000;
  const week = (household.activityLog ?? []).filter((r) => new Date(r.at).getTime() >= since);
  const byGame = new Map<Game, { count: number; seconds: number; last: string }>();
  for (const r of week) {
    const g = byGame.get(r.game) ?? { count: 0, seconds: 0, last: r.at };
    byGame.set(r.game, { count: g.count + 1, seconds: g.seconds + r.seconds, last: r.at > g.last ? r.at : g.last });
  }
  const rows = [...byGame.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
  const total = Math.max(1, Math.round(week.reduce((s, r) => s + r.seconds, 0) / 60));
  return (
    <section className="card" aria-labelledby="act-h">
      <h2 id="act-h">Activities this week</h2>
      {rows.length === 0 ? (
        <p className="muted">
          No activities yet. {household.elder.name} can tap <strong>Activities</strong> for games, the Today board and
          chair exercises. They're free and don't use voice minutes.
        </p>
      ) : (
        <>
          <p className="muted">
            {total} minute{total === 1 ? "" : "s"} in total.
          </p>
          <ul className="list">
            {rows.map(([game, g]) => (
              <li key={game} className="row">
                <span className="grow">{GAME_NAMES[game]}</span>
                <span className="muted">
                  {g.count}× · {Math.max(1, Math.round(g.seconds / 60))} min
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface Place {
  name: string;
  country?: string;
  latitude: number;
  longitude: number;
}

/** Weather town, currency, exercises and the daily live-voice limit. */
export function EngagementSettings({ household, dispatch }: { household: Household; dispatch: Dispatch }) {
  const e = household.elder;
  const set = (patch: Partial<typeof e>) => void dispatch({ type: "updateElder", patch });
  const [town, setTown] = useState(e.town ?? "");
  const [townNote, setTownNote] = useState<string | null>(null);
  const today = localClock(new Date(), e.timezone).date;
  const usedMin = Math.round((household.voiceUsage?.[today] ?? 0) / 60);
  const left = voiceMinutesLeft(household);

  const findTown = async () => {
    const q = town.trim();
    if (!q) {
      set({ town: undefined, lat: undefined, lon: undefined });
      return setTownNote("Weather turned off.");
    }
    setTownNote("Looking it up…");
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`);
      const d = (await r.json()) as { results?: Place[] };
      const p = d.results?.[0];
      if (!p) return setTownNote("Couldn't find that town. Try the nearest city.");
      set({ town: p.name, lat: p.latitude, lon: p.longitude });
      setTown(p.name);
      setTownNote(`Weather set for ${p.name}${p.country ? `, ${p.country}` : ""}.`);
    } catch {
      setTownNote("Couldn't look that up right now.");
    }
  };

  return (
    <section className="card" aria-labelledby="eng-h">
      <h2 id="eng-h">Activities & voice</h2>
      <div className="form">
        <label>
          Town for the weather
          <span className="row-input">
            <input value={town} onChange={(ev) => setTown(ev.target.value)} placeholder="Kumasi" />
            <button type="button" className="btn" onClick={findTown}>
              Set
            </button>
          </span>
          {townNote && <span className="muted">{townNote}</span>}
        </label>
        <label>
          Money in market maths
          <input
            defaultValue={e.currency ?? ""}
            placeholder={currencyFor({ ...household, elder: { ...e, currency: undefined } })}
            onBlur={(ev) => set({ currency: ev.target.value.trim() || undefined })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={e.exercisesEnabled !== false}
            onChange={(ev) => set({ exercisesEnabled: ev.target.checked })}
          />
          Offer chair exercises
        </label>
        <label>
          Live voice minutes for chatting, per day
          <select
            value={String(e.voiceMinutesPerDay ?? 0)}
            onChange={(ev) => set({ voiceMinutesPerDay: Number(ev.target.value) || undefined })}
          >
            <option value="0">No limit</option>
            {[5, 10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
          <span className="muted">
            Used today: {usedMin} min{left !== null ? ` · ${Math.floor(left)} min left` : ""}. Help and medicine reminders
            always use the live voice; after the limit, chatting uses the free practice voice.
          </span>
        </label>
      </div>
    </section>
  );
}
