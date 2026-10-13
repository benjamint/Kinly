import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useHousehold } from "../lib/household-context";
import { localClock, todaysReminders, unreadFamilyMessages } from "../shared/household";
import type { Household, Language } from "../shared/types";
import { sayOnce } from "./sound";

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <header className="sheet__head">
        <h1 id="sheet-title">{title}</h1>
        <button className="sheet__close" onClick={onClose}>
          Back
        </button>
      </header>
      <div className="sheet__body">{children}</div>
    </div>
  );
}

export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function FamilySheet({
  household,
  onClose,
  onSendMessage,
}: {
  household: Household;
  onClose: () => void;
  onSendMessage: () => void;
}) {
  const { dispatch } = useHousehold();
  const lang = household.elder.language === "sw" ? "sw-KE" : "en-GB";
  const recent = household.messages.slice(-12).reverse();

  // Opening the sheet counts as seeing the new messages.
  useEffect(() => {
    const unread = unreadFamilyMessages(household);
    if (unread.length) void dispatch({ type: "markMessagesRead", ids: unread.map((m) => m.id) });
  }, []);

  return (
    <Sheet title="Family" onClose={onClose}>
      <button className="big-button big-button--primary" onClick={onSendMessage}>
        Send a message
      </button>
      {recent.length === 0 && <p className="empty">No messages yet.</p>}
      <ul className="messages">
        {recent.map((m) => (
          <li key={m.id} className={`message message--${m.direction}${m.readAt ? "" : " message--new"}`}>
            <p className="message__who">
              {m.direction === "family" ? m.familyName : `You → ${m.familyName}`} · {timeAgo(m.at)}
            </p>
            <p className="message__text">{m.text}</p>
            {m.direction === "family" && (
              <button
                className="small-button"
                onClick={() => sayOnce(`${m.familyName} says: ${m.text}`, lang, household.elder.speechSpeed)}
              >
                Read it to me
              </button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const STATUS_TEXT = { taken: "Done", missed: "Missed", due: "Now", upcoming: "Later" } as const;

export function RemindersSheet({
  household,
  now,
  onClose,
  onAsk,
}: {
  household: Household;
  now: Date;
  onClose: () => void;
  onAsk: (reminderId: string) => void;
}) {
  const { dispatch } = useHousehold();
  const today = todaysReminders(household, now);
  const { date } = localClock(now, household.elder.timezone);
  return (
    <Sheet title="Today" onClose={onClose}>
      {today.length === 0 && <p className="empty">Nothing planned for today.</p>}
      <ul className="reminders">
        {today.map(({ reminder, status }) => (
          <li key={reminder.id} className={`reminder reminder--${status}`}>
            <span className="reminder__time">{reminder.time}</span>
            <span className="reminder__what">
              <span className="reminder__label">{reminder.label}</span>
              {reminder.instructions && <span className="reminder__instr">{reminder.instructions}</span>}
            </span>
            <span className="reminder__status">{STATUS_TEXT[status]}</span>
            {(status === "due" || status === "missed") && (
              <span className="reminder__actions">
                <button
                  className="big-button big-button--primary"
                  onClick={() => void dispatch({ type: "confirmReminder", reminderId: reminder.id, date })}
                >
                  {reminder.kind === "meal" ? "I've eaten" : "I've taken it"}
                </button>
                <button className="small-button" onClick={() => onAsk(reminder.id)}>
                  Talk about it
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const SPEEDS = [
  { label: "Slower", value: 0.75 },
  { label: "Normal", value: 0.9 },
  { label: "Faster", value: 1.05 },
];

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "sw", label: "Kiswahili" },
];

export function SettingsSheet({ household, onClose }: { household: Household; onClose: () => void }) {
  const { dispatch, connection, disconnect } = useHousehold();
  const e = household.elder;
  const set = (patch: Partial<typeof e>) => void dispatch({ type: "updateElder", patch });
  return (
    <Sheet title="Settings" onClose={onClose}>
      <fieldset className="choice">
        <legend>Language</legend>
        {LANGUAGES.map((l) => (
          <button key={l.value} aria-pressed={e.language === l.value} onClick={() => set({ language: l.value })}>
            {l.label}
          </button>
        ))}
      </fieldset>
      <fieldset className="choice">
        <legend>How fast Kinly talks</legend>
        {SPEEDS.map((s) => (
          <button key={s.value} aria-pressed={e.speechSpeed === s.value} onClick={() => set({ speechSpeed: s.value })}>
            {s.label}
          </button>
        ))}
      </fieldset>
      <fieldset className="choice">
        <legend>Words on screen</legend>
        <button aria-pressed={!e.showCaptions} onClick={() => set({ showCaptions: false })}>
          Off
        </button>
        {[1, 1.4, 1.8].map((scale, i) => (
          <button
            key={scale}
            aria-pressed={e.showCaptions && e.captionScale === scale}
            onClick={() => set({ showCaptions: true, captionScale: scale })}
            style={{ fontSize: `${1 + i * 0.25}em` }}
          >
            A
          </button>
        ))}
      </fieldset>
      <div className="settings__links">
        <Link className="small-button" to="/family">
          Open family dashboard
        </Link>
        <button className="small-button" onClick={disconnect}>
          {connection?.mode === "cloud" ? `Leave household ${connection.id}` : "Leave demo"}
        </button>
      </div>
    </Sheet>
  );
}
