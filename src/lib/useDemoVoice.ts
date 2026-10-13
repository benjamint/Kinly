import { useCallback, useEffect, useRef, useState } from "react";
import type { Household, HouseholdAction } from "../shared/types";
import { greeting, reminderPrompt, respond, type BrainContext } from "./demo-brain";
import type { StartOptions, VoiceEngine, VoiceState } from "./voice";

// Minimal browser types for the (prefixed) Web Speech recognition API.
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANG = { en: "en-GB", sw: "sw-KE" } as const;
/** Give up after this many turns where nothing was heard. */
const MAX_SILENCES = 2;

/**
 * Voice using only what the phone's browser provides (speech synthesis +
 * speech recognition) and the rule-based demo brain. No keys, no backend.
 */
export function useDemoVoice(
  household: Household | null,
  dispatch: (...actions: HouseholdAction[]) => Promise<void>,
): VoiceEngine {
  const [state, setState] = useState<VoiceState>("idle");
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const householdRef = useRef(household);
  householdRef.current = household;
  const session = useRef(0); // bumps on every start/stop to cancel stale callbacks
  const context = useRef<BrainContext>({});
  const silences = useRef(0);
  const recognition = useRef<Recognition | null>(null);
  const speakingSince = useRef<number | null>(null);

  const stop = useCallback(() => {
    session.current++;
    recognition.current?.abort();
    recognition.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    speakingSince.current = null;
    setActiveTool(null);
    setState("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const speak = useCallback((text: string, id: number, then: () => void) => {
    const h = householdRef.current;
    setCaption(text);
    if (typeof speechSynthesis === "undefined") {
      setState("speaking");
      setTimeout(() => id === session.current && then(), 1500 + text.length * 40);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG[h?.elder.language ?? "en"];
    u.rate = h?.elder.speechSpeed ?? 0.9;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.onstart = () => {
      if (id !== session.current) return;
      speakingSince.current = performance.now();
      setState("speaking");
    };
    u.onend = u.onerror = () => {
      if (id !== session.current) return;
      speakingSince.current = null;
      then();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, []);

  const listen = useCallback(
    (id: number) => {
      const Ctor = recognitionCtor();
      if (!Ctor) {
        // No speech recognition on this browser: speak only.
        setState("idle");
        return;
      }
      const r = new Ctor();
      r.lang = LANG[householdRef.current?.elder.language ?? "en"];
      r.interimResults = false;
      r.maxAlternatives = 1;
      let got = false;
      r.onresult = (e) => {
        got = true;
        const text = e.results[0]?.[0]?.transcript ?? "";
        setHeard(text);
        setState("thinking");
        const h = householdRef.current;
        if (!h || id !== session.current) return;
        silences.current = 0;
        const reply = respond(h, text, context.current);
        context.current = reply.context;
        const tool = reply.actions.find((a) => a.type === "raiseAlert") ? "raise_alert" : null;
        setActiveTool(tool);
        void dispatch(...reply.actions);
        speak(reply.say, id, () => {
          setActiveTool(null);
          if (reply.end) stop();
          else listen(id);
        });
      };
      r.onerror = (e) => {
        if (id !== session.current) return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Kinly needs the microphone. Please allow it in the browser.");
          setState("error");
        }
      };
      r.onend = () => {
        if (id !== session.current || got) return;
        silences.current++;
        if (silences.current > MAX_SILENCES) stop();
        else listen(id);
      };
      recognition.current = r;
      setState("listening");
      try {
        r.start();
      } catch {
        stop();
      }
    },
    [dispatch, speak, stop],
  );

  const start = useCallback(
    (options: StartOptions = {}) => {
      const h = householdRef.current;
      if (!h) return;
      stop();
      const id = ++session.current;
      setError(null);
      setHeard("");
      silences.current = 0;
      context.current = {
        reminderId: options.reminderId,
        askingWho: options.askingWho,
        composingTo: options.replyTo,
      };
      const opening =
        options.firstMessage ?? (options.reminderId ? reminderPrompt(h, options.reminderId) : greeting(h));
      setState("connecting");
      speak(opening, id, () => listen(id));
    },
    [listen, speak, stop],
  );

  // speechSynthesis gives no audio levels, so imitate the rhythm of speech.
  const getVolume = useCallback(() => {
    if (speakingSince.current === null) return 0;
    const t = (performance.now() - speakingSince.current) / 1000;
    const syllables = Math.abs(Math.sin(t * 11)) * 0.7 + Math.abs(Math.sin(t * 3.3)) * 0.3;
    return 0.15 + syllables * 0.6;
  }, []);

  return { state, caption, heard, error, activeTool, start, stop, getVolume };
}
