import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHousehold } from "../lib/household-context";
import { useDemoVoice } from "../lib/useDemoVoice";
import { useElevenLabsVoice } from "../lib/useElevenLabsVoice";
import { introduction, reminderPrompt, whoPrompt } from "../lib/demo-brain";
import type { VoiceEngine } from "../lib/voice";
import { isQuietTime, localClock, todaysReminders, unreadFamilyMessages } from "../shared/household";
import type { Household } from "../shared/types";
import type { Expression } from "./expression";
import { KinlyFace } from "./KinlyFace";
import { HelpButton, HelpOverlay } from "./Help";
import { FamilySheet, RemindersSheet, SettingsSheet } from "./Sheets";
import { stayAwake } from "./sound";
import { useReminderScheduler } from "./useReminderScheduler";
import { useLongPress } from "./useLongPress";

type Sheet = "family" | "reminders" | "settings" | null;

const INTRO_KEY = "kinly.introducedOn";

function helpLine(household: Household, familyNames: string): string {
  return household.elder.language === "sw"
    ? `Nimewaambia ${familyNames} kwamba unahitaji msaada. Kaa hapo ulipo, niko hapa nawe. Unajisikiaje?`
    : `I've told ${familyNames} that you need help. Stay where you are, I'm here with you. Can you tell me what happened?`;
}

function readAloudLine(household: Household, familyName: string, text: string): string {
  const said = /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
  return household.elder.language === "sw"
    ? `${familyName} anasema: ${said} Ungependa kujibu?`
    : `${familyName} says: ${said} Would you like to reply?`;
}

/** Kinly says it is an AI assistant in the first conversation of each day. */
function needsIntroduction(date: string): boolean {
  try {
    if (localStorage.getItem(INTRO_KEY) === date) return false;
    localStorage.setItem(INTRO_KEY, date);
  } catch {
    /* storage unavailable: introduce every time, which is the safe side */
  }
  return true;
}

const STATUS: Partial<Record<Expression, string>> = {
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Clock({ household, now, onLongPress }: { household: Household; now: Date; onLongPress: () => void }) {
  const press = useLongPress(onLongPress, 2000);
  const tz = household.elder.timezone;
  const locale = household.elder.language === "sw" ? "sw-KE" : "en-GB";
  return (
    <div className="clock" {...press} aria-label="Clock. Press and hold for settings.">
      <span className="clock__time">
        {new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(now)}
      </span>
      <span className="clock__day">
        {new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(now)}
      </span>
    </div>
  );
}

export function ElderScreen() {
  const { household, connection, config, dispatch, refresh } = useHousehold();
  const live = connection?.mode === "cloud" && config.voice;
  const demoVoice = useDemoVoice(household, dispatch);
  const liveVoice = useElevenLabsVoice(connection, household, refresh);
  const voice: VoiceEngine = live ? liveVoice : demoVoice;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const now = useNow();
  const busy = voice.state !== "idle" && voice.state !== "error";

  const startReminder = useCallback(
    (reminderId: string) => {
      if (!household) return;
      setSheet(null);
      voice.start({ reminderId, firstMessage: reminderPrompt(household, reminderId) });
    },
    [household, voice],
  );
  useReminderScheduler(household, busy || helpOpen, dispatch, startReminder);

  // Keep the last caption up for a while after Kinly finishes talking.
  const [showCaption, setShowCaption] = useState(false);
  const captionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(captionTimer.current);
    if (busy) setShowCaption(true);
    else captionTimer.current = setTimeout(() => setShowCaption(false), 8000);
  }, [busy, voice.caption]);

  const expression: Expression = useMemo(() => {
    if (helpOpen || voice.activeTool === "raise_alert") return "concerned";
    switch (voice.state) {
      case "speaking":
        return "speaking";
      case "listening":
        return "listening";
      case "thinking":
      case "connecting":
        return "thinking";
      case "error":
        return "concerned";
      default:
        return household && isQuietTime(household, now) ? "sleeping" : "idle";
    }
  }, [helpOpen, voice.activeTool, voice.state, household, now]);

  if (!household) return null;

  const unread = unreadFamilyMessages(household).length;
  const due = todaysReminders(household, now).filter((t) => t.status === "due").length;
  const familyNames = household.family.map((f) => f.name).join(" and ") || "your family";

  const onFaceTap = () => {
    void stayAwake();
    if (busy) return voice.stop();
    const { date } = localClock(new Date(), household.elder.timezone);
    voice.start(needsIntroduction(date) ? { firstMessage: introduction(household, new Date()) } : undefined);
  };

  const hint =
    voice.state === "error"
      ? (voice.error ?? "Something went wrong. Tap to try again.")
      : voice.state === "listening"
        ? "I'm listening…"
        : busy
          ? "Tap the screen to stop"
          : expression === "sleeping"
            ? "Resting. Tap the screen if you need me."
            : "Tap the screen to talk to me";

  return (
    <main className={`elder elder--${expression}`}>
      <button className="elder__face" onClick={onFaceTap} aria-label={hint}>
        <KinlyFace expression={expression} getVolume={voice.getVolume} />
      </button>

      <header className="elder__top">
        <Clock household={household} now={now} onLongPress={() => setSheet("settings")} />
        <div className="elder__badges">
          <span className="elder__badge elder__badge--ai">Kinly · AI assistant</span>
          {!live && <span className="elder__badge">Practice voice</span>}
        </div>
      </header>

      {STATUS[expression] && (
        <div className={`status status--${expression}`} aria-hidden="true">
          <span className="status__dots">
            <i />
            <i />
            <i />
          </span>
          {STATUS[expression]}
        </div>
      )}

      <div className="elder__caption-area" aria-live="polite">
        {household.elder.showCaptions && showCaption && voice.caption ? (
          <p className="caption" style={{ fontSize: `calc(var(--caption-size) * ${household.elder.captionScale})` }}>
            {voice.caption}
          </p>
        ) : (
          <p className="hint">{hint}</p>
        )}
      </div>

      <nav className="toolbar" aria-label="Kinly tools">
        <button className="tool tool--family" onClick={() => setSheet("family")}>
          <span className="tool__icon" aria-hidden="true">
            <svg viewBox="0 0 48 48"><circle cx="17" cy="15" r="7" /><circle cx="33" cy="17" r="6" /><path d="M4 40c0-8 6-14 13-14s13 6 13 14z" /><path d="M28 40c0-5 1-9 4-12 6 0 12 5 12 12z" /></svg>
          </span>
          <span className="tool__label">Family</span>
          {unread > 0 && <span className="tool__count" aria-label={`${unread} new`}>{unread}</span>}
        </button>
        <button className="tool tool--reminders" onClick={() => setSheet("reminders")}>
          <span className="tool__icon" aria-hidden="true">
            <svg viewBox="0 0 48 48"><rect x="6" y="18" width="36" height="14" rx="7" transform="rotate(-35 24 25)" /><path d="M17 15l14 20" className="tool__stroke" /></svg>
          </span>
          <span className="tool__label">Reminders</span>
          {due > 0 && <span className="tool__count" aria-label={`${due} due now`}>{due}</span>}
        </button>
        <HelpButton
          onHelp={() => {
            setSheet(null);
            setHelpOpen(true);
            void dispatch({ type: "raiseAlert", source: "button", reason: "Pressed the Help button." });
            // Kinly's own voice tells them help is coming, then stays and talks with them.
            voice.start({
              firstMessage: helpLine(household, familyNames),
              context:
                `${household.elder.name} just pressed the Help button. ${familyNames} have ALREADY been alerted, ` +
                "so do not call raise_alert again unless something new and serious happens. Stay with them: keep them " +
                "calm, ask simply how they are and what happened, and if it sounds serious tell them to call emergency services.",
            });
          }}
        />
      </nav>

      {sheet === "family" && (
        <FamilySheet
          household={household}
          onClose={() => setSheet(null)}
          onSendMessage={() => {
            setSheet(null);
            voice.start({ askingWho: true, firstMessage: whoPrompt(household) });
          }}
          onReadAloud={(familyName, text) => {
            setSheet(null);
            voice.start({
              replyTo: familyName,
              firstMessage: readAloudLine(household, familyName, text),
              context: `You just read ${household.elder.name} this message from ${familyName}: "${text}". If they want to reply, help them send it to ${familyName}.`,
            });
          }}
        />
      )}
      {sheet === "reminders" && (
        <RemindersSheet household={household} now={now} onClose={() => setSheet(null)} onAsk={startReminder} />
      )}
      {sheet === "settings" && <SettingsSheet household={household} onClose={() => setSheet(null)} />}
      {helpOpen && <HelpOverlay household={household} familyNames={familyNames} onClose={() => setHelpOpen(false)} />}
    </main>
  );
}
