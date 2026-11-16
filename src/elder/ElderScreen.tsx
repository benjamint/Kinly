import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHousehold } from "../lib/household-context";
import { useDemoVoice } from "../lib/useDemoVoice";
import { useElevenLabsVoice } from "../lib/useElevenLabsVoice";
import { introduction, reminderPrompt, whoPrompt } from "../lib/demo-brain";
import type { StartOptions, VoiceEngine } from "../lib/voice";
import { isQuietTime, localClock, todaysReminders, unreadFamilyMessages, voiceMinutesLeft } from "../shared/household";
import type { Game, Household } from "../shared/types";
import { ActivitiesSheet, ActivityScreen } from "./activities/Activities";
import type { Expression } from "./expression";
import { KinlyRobot } from "./KinlyRobot";
import { VitalsRow } from "./Vitals";
import { HelpButton, HelpOverlay } from "./Help";
import { FamilySheet, RemindersSheet, SettingsSheet } from "./Sheets";
import { stayAwake } from "./sound";
import { useReminderScheduler } from "./useReminderScheduler";
import { useLongPress } from "./useLongPress";

type Sheet = "family" | "reminders" | "settings" | "activities" | null;

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

const TALK_NOTE: Partial<Record<Expression, string>> = {
  listening: "I'm listening…",
  thinking: "Thinking…",
  speaking: "Speaking… tap to stop",
};

/** Simple line icons, drawn with the current text colour. */
const ICONS = {
  family: (
    <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.3 2.9-5.2 5.5-5.2s4.9 1.9 5.5 5.2" /><circle cx="17" cy="9" r="2.5" /><path d="M15.6 13.9c2.4.2 4.1 1.9 4.6 4.6" /></svg>
  ),
  reminders: (
    <svg viewBox="0 0 24 24"><rect x="3.5" y="9" width="17" height="6.5" rx="3.25" transform="rotate(-35 12 12.25)" /><path d="M9.6 8.4l4.8 7.4" /></svg>
  ),
  activities: (
    <svg viewBox="0 0 24 24"><path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.2 6.9 19l1.1-5.6-4.2-3.9 5.7-.7z" /></svg>
  ),
  mic: (
    <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
  ),
  stop: (
    <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" /><circle cx="12" cy="12" r="6.4" /></svg>
  ),
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
      <span className="clock__day eyebrow">
        {new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long" }).format(now)} ·{" "}
        {new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "long" }).format(now)}
      </span>
      <span className="clock__time">
        {new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(now)}
      </span>
    </div>
  );
}

export function ElderScreen() {
  const { household, connection, config, dispatch, refresh } = useHousehold();
  const live = Boolean(connection) && config.voice;
  // Which voice the current conversation uses: Kinly's live voice, or the free
  // practice voice once today's chat minutes are used up.
  const [engine, setEngine] = useState<"live" | "free">("live");
  const demoVoice = useDemoVoice(household, dispatch);
  const onUsage = useCallback(
    (seconds: number) => {
      if (!household || seconds < 1) return;
      const { date } = localClock(new Date(), household.elder.timezone);
      void dispatch({ type: "logVoiceUsage", date, seconds });
    },
    [household, dispatch],
  );
  const onCapReached = useCallback(
    (options: StartOptions) => {
      setEngine("free");
      demoVoice.start(options);
    },
    [demoVoice],
  );
  const liveVoice = useElevenLabsVoice(connection, household, refresh, onUsage, onCapReached);
  const capUsed = household ? voiceMinutesLeft(household) === 0 : false;
  const active = live && engine === "live" ? liveVoice : demoVoice;
  const voice: VoiceEngine = {
    ...active,
    // Stop whichever voice is running (a start may have fallen back to the free voice).
    stop: () => {
      liveVoice.stop();
      demoVoice.stop();
    },
    send: (text: string) => {
      if (live && !capUsed) {
        setEngine("live");
        liveVoice.send(text);
      } else {
        if (live) liveVoice.stop();
        setEngine("free");
        demoVoice.send(text);
      }
    },
    start: (options: StartOptions = {}) => {
      const essential = options.purpose === "help" || options.purpose === "reminder";
      if (live && (essential || !capUsed)) {
        setEngine("live");
        liveVoice.start(options);
      } else {
        setEngine("free");
        demoVoice.start(options);
      }
    },
  };

  const [sheet, setSheet] = useState<Sheet>(null);
  const [activity, setActivity] = useState<Game | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const now = useNow();
  const busy = voice.state !== "idle" && voice.state !== "error";

  const startReminder = useCallback(
    (reminderId: string) => {
      if (!household) return;
      setSheet(null);
      setActivity(null);
      voice.start({ reminderId, purpose: "reminder", firstMessage: reminderPrompt(household, reminderId) });
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

  // On phones the conversation card sits below Kinly: bring it into view when talking starts.
  const saidRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (busy && window.innerWidth < 700 && !(window.innerWidth > window.innerHeight)) {
      saidRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [busy]);

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
      : expression === "sleeping"
        ? "Resting. Tap if you need me."
        : busy
          ? (TALK_NOTE[expression] ?? "Connecting…")
          : "Uses your microphone";
  const chat = household.elder.showCaptions && showCaption;
  const sw = household.elder.language === "sw";
  const minutes = localClock(now, household.elder.timezone).minutes;
  const greeting = sw
    ? `${minutes < 720 ? "Habari za asubuhi" : minutes < 1020 ? "Habari za mchana" : "Habari za jioni"}, ${household.elder.name}.`
    : `Good ${minutes < 720 ? "morning" : minutes < 1020 ? "afternoon" : "evening"}, ${household.elder.name}.`;

  const status = busy
    ? voice.state === "listening"
      ? sw ? "Ninasikiliza…" : "Listening…"
      : voice.state === "speaking"
        ? sw ? "Kinly anaongea" : "Kinly is speaking"
        : voice.state === "thinking"
          ? sw ? "Anafikiri…" : "Thinking…"
          : sw ? "Anaunganisha…" : "Connecting…"
    : expression === "sleeping"
      ? sw ? "Anapumzika" : "Resting"
      : sw ? "Niko tayari ukiwa tayari" : "Ready when you are";
  const stateTag = busy ? (sw ? "Ameunganishwa" : "Connected") : expression === "sleeping" ? (sw ? "Anapumzika" : "Resting") : sw ? "Tayari" : "Ready";
  const name = household.elder.name;
  const [hello] = greeting.split(",");
  const kinlyLine =
    (chat && voice.caption) ||
    (sw ? `Habari ${name}. Unajisikiaje leo?` : `Hello ${name}. How are you feeling today?`);
  const sendTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    void stayAwake();
    setTyped("");
    voice.send(text);
  };

  return (
    <main className={`elder elder--${expression}${busy ? " elder--busy" : ""}`}>
      <header className="elder__top">
        <Clock household={household} now={now} onLongPress={() => setSheet("settings")} />
        <div className="elder__badges">
          <span className={`presence${busy ? " presence--on" : ""}`}>
            <i aria-hidden="true" />
            {busy ? status : sw ? "Kinly yupo" : "Kinly is here"}
          </span>
          {(!live || capUsed) && (
            <span className="chip chip--extra">{live ? "Practice voice · minutes used" : "Practice voice"}</span>
          )}
        </div>
        <button
          className="icon-btn"
          onClick={() => { voice.stop(); setSheet("settings"); }}
          aria-label={sw ? "Mipangilio" : "Settings"}
          title={sw ? "Mipangilio" : "Settings"}
        >
          <span aria-hidden="true">{ICONS.settings}</span>
        </button>
      </header>

      <section className="elder__stage">
        <span className="stage__eyebrow eyebrow">{sw ? "Muda wako" : "A moment for you"}</span>
        <div className="stage__rings" aria-hidden="true">
          <i /><i /><i />
        </div>
        <button className="elder__robot" onClick={onFaceTap} aria-label={hint}>
          <KinlyRobot expression={expression} getVolume={voice.getVolume} look={household.elder.robotLook} />
        </button>
        <VitalsRow household={household} now={now} where="stage" />
        <p className="stage__tag"><span className="o-dash" aria-hidden="true" />{sw ? "Niko hapa wakati wowote" : "Here, whenever you need"}</p>
        <footer className="stage__foot">
          <span className="mini-kinly" aria-hidden="true"><i /><i /></span>
          <span className="stage__who">
            <strong>Kinly</strong>
            <small>{sw ? "Msaidizi wako wa AI" : "Your AI companion"}</small>
          </span>
          <span className={`stage__state${busy ? " stage__state--on" : ""}`}>{stateTag}</span>
        </footer>
      </section>

      <div className="elder__side">
        <div className="elder__hello">
          <span className="eyebrow eyebrow--dash"><span className="o-dash" aria-hidden="true" />{sw ? "Nafasi yako, mwendo wako" : "Your space, your pace"}</span>
          <h2 className="display">
            {hello},<br />
            <span className="display__name">{name}.</span>
          </h2>
          <p className="lead">{sw ? "Njia laini ya kukaa karibu." : "A softer way to stay connected."}</p>
        </div>

        <VitalsRow household={household} now={now} where="side" />

        <div className="mind">
          <p className="mind__label"><span className="eyebrow">{sw ? "Akilini mwako" : "On your mind"}</span><span className="mind__rule" /><span>{sw ? "Pa kuanzia" : "A place to begin"}</span></p>
          <nav className="toolbar" aria-label="Kinly tools">
            <button className="tool tool--family" onClick={() => setSheet("family")}>
              <span className="tool__icon" aria-hidden="true">{ICONS.family}</span>
              <span className="tool__label">{sw ? "Familia" : "Family"}</span>
              {unread > 0 && <span className="tool__count" aria-label={`${unread} new`}>{unread}</span>}
            </button>
            <button className="tool tool--reminders" onClick={() => setSheet("reminders")}>
              <span className="tool__icon" aria-hidden="true">{ICONS.reminders}</span>
              <span className="tool__label">{sw ? "Vikumbusho" : "Reminders"}</span>
              {due > 0 && <span className="tool__count" aria-label={`${due} due now`}>{due}</span>}
            </button>
            <button className="tool tool--activities" onClick={() => { voice.stop(); setSheet("activities"); }}>
              <span className="tool__icon" aria-hidden="true">{ICONS.activities}</span>
              <span className="tool__label">{sw ? "Michezo" : "Activities"}</span>
            </button>
            <HelpButton
              onHelp={() => {
                setSheet(null);
                setHelpOpen(true);
                void dispatch({ type: "raiseAlert", source: "button", reason: "Pressed the Help button." });
                // Kinly's own voice tells them help is coming, then stays and talks with them.
                setActivity(null);
                voice.start({
                  purpose: "help",
                  firstMessage: helpLine(household, familyNames),
                  context:
                    `${household.elder.name} just pressed the Help button. ${familyNames} have ALREADY been alerted, ` +
                    "so do not call raise_alert again unless something new and serious happens. Stay with them: keep them " +
                    "calm, ask simply how they are and what happened, and if it sounds serious tell them to call emergency services.",
                });
              }}
            />
          </nav>
        </div>

        <article ref={saidRef} className={`said${expression === "speaking" ? " said--speaking" : ""}`} aria-live="polite">
          <header className="said__head">
            <span className="mini-kinly" aria-hidden="true"><i /><i /></span>
            <strong>Kinly</strong>
            <span className="said__when">{sw ? "Sasa hivi" : "Just now"}</span>
            <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </header>
          <p className="said__text" style={{ fontSize: `calc(var(--said-size) * ${household.elder.captionScale})` }}>
            {kinlyLine}
          </p>
          <p className="said__foot">
            {chat && voice.heard ? (
              <><span className="said__you">{sw ? "Wewe:" : "You:"}</span> {voice.heard}</>
            ) : (
              <><span className="star" aria-hidden="true">✳</span> {sw ? "Hakuna haraka. Niko hapa." : "No rush. I'm right here."}</>
            )}
          </p>
        </article>

        <div className="talk-dock">
          <p className={`talk-status${busy ? " talk-status--on" : ""}`}><i aria-hidden="true" />{status}</p>
          <button className={`talk${busy ? " talk--on" : ""}`} onClick={onFaceTap} title={hint}>
            <span className="talk__icon" aria-hidden="true">{busy ? ICONS.stop : ICONS.mic}</span>
            <span className="talk__text">
              <strong>{busy ? (sw ? "Acha kuongea" : "Stop talking") : sw ? "Tuongee" : "Let's talk"}</strong>
              <small>{busy ? (sw ? "Gusa kumaliza" : "Tap to finish") : sw ? "Gusa mara moja, kisha ongea tu" : "Tap once, then just speak"}</small>
            </span>
            <span className="talk__arrow" aria-hidden="true">{ICONS.arrow}</span>
          </button>
        </div>

        <div className="type">
          {typing ? (
            <form className="type__form" onSubmit={sendTyped}>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={sw ? "Andika kwa Kinly…" : "Write to Kinly…"}
                aria-label={sw ? "Andika kwa Kinly" : "Write to Kinly"}
                enterKeyHint="send"
              />
              <button className="type__send" type="submit" disabled={!typed.trim()}>{sw ? "Tuma" : "Send"}</button>
              <button className="type__close" type="button" onClick={() => setTyping(false)} aria-label={sw ? "Funga" : "Close"}>×</button>
            </form>
          ) : (
            <button className="type__link" onClick={() => setTyping(true)}>{sw ? "Au andika badala yake" : "Or type instead"}</button>
          )}
        </div>
      </div>

      <footer className="elder__foot" aria-hidden="true">
        <span>Made for the moments that matter</span>
        <span className="star">✳</span>
        <span>Kinly · {new Date().getFullYear()}</span>
      </footer>

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
      {sheet === "activities" && (
        <ActivitiesSheet
          household={household}
          onClose={() => setSheet(null)}
          onOpen={(game) => {
            setSheet(null);
            setActivity(game);
          }}
        />
      )}
      {activity && (
        <ActivityScreen
          household={household}
          game={activity}
          onClose={() => {
            setActivity(null);
            setSheet("activities");
          }}
        />
      )}
      {helpOpen && <HelpOverlay household={household} familyNames={familyNames} onClose={() => setHelpOpen(false)} />}
    </main>
  );
}
