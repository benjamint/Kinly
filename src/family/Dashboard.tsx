import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useHousehold } from "../lib/household-context";
import { newId, openAlerts, todaysReminders } from "../shared/household";
import type { Household, Language, Reminder, ReminderKind } from "../shared/types";
import { timeAgo } from "../elder/Sheets";

const ME_KEY = "kinly.familyMe";

function useMe(household: Household) {
  const [me, setMe] = useState<string>(() => {
    try {
      return localStorage.getItem(ME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const valid = household.family.some((f) => f.name === me);
  const name = valid ? me : (household.family[0]?.name ?? "Family");
  const choose = (n: string) => {
    setMe(n);
    try {
      localStorage.setItem(ME_KEY, n);
    } catch {
      /* ignore */
    }
  };
  return [name, choose] as const;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Dashboard() {
  const { household, dispatch, connection, error, disconnect } = useHousehold();
  const now = useNow();
  if (!household) return null;
  return (
    <DashboardView
      household={household}
      now={now}
      dispatch={dispatch}
      mode={connection?.mode ?? "local"}
      error={error}
      onLeave={disconnect}
    />
  );
}

function DashboardView({
  household,
  now,
  dispatch,
  mode,
  error,
  onLeave,
}: {
  household: Household;
  now: Date;
  dispatch: ReturnType<typeof useHousehold>["dispatch"];
  mode: "local" | "cloud";
  error: string | null;
  onLeave: () => void;
}) {
  const [me, setMe] = useMe(household);
  const alerts = openAlerts(household);
  const today = todaysReminders(household, now);
  const elder = household.elder.name;

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>{elder}'s Kinly</h1>
          <p className="dash__sub">
            {mode === "local" ? "Demo on this device" : `Household ${household.id}`} ·{" "}
            <Link to="/">Open {elder}'s screen</Link>
          </p>
        </div>
        <label className="dash__me">
          I am
          <select value={me} onChange={(e) => setMe(e.target.value)}>
            {household.family.map((f) => (
              <option key={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      </header>
      {error && <p className="dash__error" role="alert">{error}</p>}

      {alerts.length > 0 && (
        <section className="card card--alert" aria-labelledby="alerts-h">
          <h2 id="alerts-h">Needs attention</h2>
          <ul className="list">
            {alerts.map((a) => (
              <li key={a.id} className="row">
                <div>
                  <strong>{a.source === "missed" ? "Missed medication" : "Asked for help"}</strong>
                  <p>{a.reason}</p>
                  <p className="muted">{timeAgo(a.at, now.getTime())}</p>
                </div>
                <button
                  className="btn btn--primary"
                  onClick={() => void dispatch({ type: "acknowledgeAlert", alertId: a.id, by: me })}
                >
                  I'm on it
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="dash__grid">
        <section className="card" aria-labelledby="today-h">
          <h2 id="today-h">Today</h2>
          {today.length === 0 && <p className="muted">No reminders set.</p>}
          <ul className="list">
            {today.map(({ reminder, status, log }) => (
              <li key={reminder.id} className="row">
                <span className="mono">{reminder.time}</span>
                <span className="grow">{reminder.label}</span>
                <span className={`pill pill--${status}`}>
                  {status === "taken" && log ? `Taken ${timeAgo(log.at, now.getTime())}` : status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <Messages household={household} me={me} dispatch={dispatch} now={now} />
      </div>

      <ReminderEditor household={household} dispatch={dispatch} />
      <SettingsCard household={household} dispatch={dispatch} />
      <p className="dash__foot">
        <button className="link" onClick={onLeave}>
          {mode === "local" ? "Leave demo" : "Sign out of this household"}
        </button>
      </p>
    </div>
  );
}

function Messages({
  household,
  me,
  dispatch,
  now,
}: {
  household: Household;
  me: string;
  dispatch: ReturnType<typeof useHousehold>["dispatch"];
  now: Date;
}) {
  const [text, setText] = useState("");
  const thread = household.messages.slice(-30).reverse();
  return (
    <section className="card" aria-labelledby="msg-h">
      <h2 id="msg-h">Messages</h2>
      <form
        className="compose"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void dispatch({ type: "familyMessage", familyName: me, text });
          setText("");
        }}
      >
        <label htmlFor="compose">Kinly will read this to {household.elder.name}</label>
        <textarea id="compose" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <button className="btn btn--primary">Send as {me}</button>
      </form>
      <ul className="list">
        {thread.map((m) => (
          <li key={m.id} className={`bubble bubble--${m.direction}`}>
            <p className="muted">
              {m.direction === "family"
                ? `${m.familyName} → ${household.elder.name} · ${m.readAt ? "heard" : "not heard yet"}`
                : `${household.elder.name} → ${m.familyName} (spoken)`}{" "}
              · {timeAgo(m.at, now.getTime())}
            </p>
            <p>{m.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

const blankReminder = (): Reminder => ({
  id: newId(),
  kind: "medication",
  label: "",
  time: "08:00",
  instructions: "",
  active: true,
});

function ReminderEditor({
  household,
  dispatch,
}: {
  household: Household;
  dispatch: ReturnType<typeof useHousehold>["dispatch"];
}) {
  const [draft, setDraft] = useState<Reminder | null>(null);
  const sorted = [...household.reminders].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <section className="card" aria-labelledby="rem-h">
      <h2 id="rem-h">Reminders</h2>
      <p className="muted">
        Kinly reads instructions exactly as written here and never gives medical advice. Unconfirmed medication after
        30 minutes alerts the family.
      </p>
      <ul className="list">
        {sorted.map((r) => (
          <li key={r.id} className="row">
            <span className="mono">{r.time}</span>
            <span className="grow">
              {r.label} <span className="muted">({r.kind}{r.active ? "" : ", paused"})</span>
              {r.instructions && <span className="muted block">{r.instructions}</span>}
            </span>
            <button className="btn" onClick={() => setDraft({ ...r })}>
              Edit
            </button>
          </li>
        ))}
      </ul>
      {!draft && (
        <button className="btn btn--primary" onClick={() => setDraft(blankReminder())}>
          Add reminder
        </button>
      )}
      {draft && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.label.trim()) return;
            void dispatch({
              type: "saveReminder",
              reminder: { ...draft, label: draft.label.trim(), instructions: draft.instructions?.trim() || undefined },
            });
            setDraft(null);
          }}
        >
          <label>
            Type
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as ReminderKind })}
            >
              <option value="medication">Medication</option>
              <option value="meal">Meal</option>
            </select>
          </label>
          <label>
            What Kinly calls it
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="blood pressure tablet"
              required
            />
          </label>
          <label>
            Time
            <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} required />
          </label>
          <label>
            Exact instructions (from the doctor or pharmacist)
            <input
              value={draft.instructions ?? ""}
              onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              placeholder="One tablet with water, after breakfast."
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            Active
          </label>
          <div className="form__actions">
            <button className="btn btn--primary">Save</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {household.reminders.some((r) => r.id === draft.id) && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  void dispatch({ type: "deleteReminder", reminderId: draft.id });
                  setDraft(null);
                }}
              >
                Delete
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function SettingsCard({
  household,
  dispatch,
}: {
  household: Household;
  dispatch: ReturnType<typeof useHousehold>["dispatch"];
}) {
  const e = household.elder;
  const [newName, setNewName] = useState("");
  const [newRelation, setNewRelation] = useState("");
  const set = (patch: Partial<typeof e>) => void dispatch({ type: "updateElder", patch });
  return (
    <section className="card" aria-labelledby="set-h">
      <h2 id="set-h">Settings</h2>
      <div className="form">
        <label>
          Name Kinly uses
          <input defaultValue={e.name} onBlur={(ev) => ev.target.value.trim() && set({ name: ev.target.value.trim() })} />
        </label>
        <label>
          Language
          <select value={e.language} onChange={(ev) => set({ language: ev.target.value as Language })}>
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </label>
        <label>
          Time zone
          <input defaultValue={e.timezone} onBlur={(ev) => validTimeZone(ev.target.value.trim()) && set({ timezone: ev.target.value.trim() })} />
        </label>
        <label>
          Quiet from
          <input
            type="time"
            value={e.quietHours.start}
            onChange={(ev) => set({ quietHours: { ...e.quietHours, start: ev.target.value } })}
          />
        </label>
        <label>
          Quiet until
          <input
            type="time"
            value={e.quietHours.end}
            onChange={(ev) => set({ quietHours: { ...e.quietHours, end: ev.target.value } })}
          />
        </label>
      </div>

      <h3>Family circle</h3>
      <p className="muted">These people are alerted when {e.name} asks for help.</p>
      <ul className="list">
        {household.family.map((f) => (
          <li key={f.id} className="row">
            <span className="grow">
              {f.name} <span className="muted">({f.relation})</span>
            </span>
            <button className="btn" onClick={() => void dispatch({ type: "deleteFamilyMember", memberId: f.id })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="form form--inline"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!newName.trim()) return;
          void dispatch({
            type: "saveFamilyMember",
            member: { id: newId(), name: newName.trim(), relation: newRelation.trim() || "family" },
          });
          setNewName("");
          setNewRelation("");
        }}
      >
        <label>
          Name
          <input value={newName} onChange={(ev) => setNewName(ev.target.value)} />
        </label>
        <label>
          Relation
          <input value={newRelation} onChange={(ev) => setNewRelation(ev.target.value)} placeholder="daughter" />
        </label>
        <button className="btn">Add</button>
      </form>
    </section>
  );
}
