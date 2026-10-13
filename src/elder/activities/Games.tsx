import { useEffect, useRef, useState } from "react";
import {
  DRUMS,
  drumNext,
  drumStart,
  encourage,
  mathsRound,
  pairsDeck,
  pairsScore,
  praise,
  proverbRound,
  currencyFor,
  type MathsRound,
  type PairCard,
  type ProverbRound,
} from "../../shared/activities";
import type { Household } from "../../shared/types";
import { drum } from "../sound";
import { speak } from "../speak";

// The brain games. Rules: big targets, no timers, never "wrong" — a miss is
// met with encouragement and the answer, and every game can be left anytime.

export interface GameProps {
  household: Household;
  level: number;
  /** Report a finished round: score 0–1. */
  onResult: (score: number) => void;
}

const t = (h: Household, en: string, sw: string) => (h.elder.language === "sw" ? sw : en);

// ---------- matching pairs ----------

export function PairsGame({ household, level, onResult }: GameProps) {
  const [deck, setDeck] = useState<PairCard[]>(() => pairsDeck(level));
  const [open, setOpen] = useState<number[]>([]);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [attempts, setAttempts] = useState(0);
  const lang = household.elder.language;
  const pairs = deck.length / 2;
  const done = found.size === pairs;

  useEffect(() => {
    speak(t(household, "Find the pairs. Tap two cards.", "Tafuta jozi. Gusa kadi mbili."), household);
  }, [household]);

  const flip = (i: number) => {
    if (open.length === 2 || open.includes(i) || found.has(deck[i].item.id)) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length < 2) return speak(deck[i].item[lang], household);
    setAttempts((a) => a + 1);
    const [a, b] = next.map((k) => deck[k].item);
    if (a.id === b.id) {
      const nowFound = new Set(found).add(a.id);
      setFound(nowFound);
      setOpen([]);
      if (nowFound.size === pairs) {
        speak(t(household, "You found them all! Wonderful.", "Umezipata zote! Hongera."), household);
        onResult(pairsScore(pairs, attempts + 1));
      } else speak(praise(lang), household);
    } else {
      setTimeout(() => setOpen([]), 1300);
    }
  };

  return (
    <div className="game">
      <div className={`pairs pairs--${deck.length}`}>
        {deck.map((c, i) => {
          const shown = open.includes(i) || found.has(c.item.id);
          return (
            <button
              key={c.key}
              className={`card${shown ? " card--shown" : ""}${found.has(c.item.id) ? " card--found" : ""}`}
              onClick={() => flip(i)}
              aria-label={shown ? c.item[lang] : t(household, "Hidden card", "Kadi iliyofichwa")}
            >
              <span className="card__face" aria-hidden="true">
                {shown ? c.item.emoji : ""}
              </span>
            </button>
          );
        })}
      </div>
      {done && (
        <button className="big-button big-button--primary" onClick={() => {
          setDeck(pairsDeck(level));
          setFound(new Set());
          setAttempts(0);
        }}>
          {t(household, "Play again", "Cheza tena")}
        </button>
      )}
    </div>
  );
}

// ---------- finish the proverb ----------

export function ProverbGame({ household, onResult }: GameProps) {
  const used = useRef<string[]>([]);
  const next = () => {
    const r = proverbRound(household.elder.language, Math.random, used.current);
    used.current = [...used.current, r.proverb.start].slice(-8);
    return r;
  };
  const [round, setRound] = useState<ProverbRound>(next);
  const [picked, setPicked] = useState<string | null>(null);
  const lang = household.elder.language;

  useEffect(() => {
    speak(`${round.proverb.start} …`, household);
  }, [round, household]);

  const choose = (c: string) => {
    if (picked) return;
    setPicked(c);
    const right = c === round.proverb.end;
    const full = `${round.proverb.start} ${round.proverb.end}`;
    speak(`${right ? praise(lang) : encourage(lang)} ${full}`, household);
    onResult(right ? 1 : 0);
  };

  return (
    <div className="game">
      <p className="game__prompt">
        <span className="game__lead">{round.proverb.start}</span> …
      </p>
      {round.proverb.origin && <p className="game__note">{round.proverb.origin} proverb</p>}
      <div className="choices">
        {round.choices.map((c) => (
          <button
            key={c}
            className={`choice-btn${picked && c === round.proverb.end ? " choice-btn--right" : ""}${picked === c && c !== round.proverb.end ? " choice-btn--tried" : ""}`}
            onClick={() => choose(c)}
          >
            {c}
          </button>
        ))}
      </div>
      {picked && (
        <button className="big-button big-button--primary" onClick={() => { setPicked(null); setRound(next()); }}>
          {t(household, "Another one", "Nyingine")}
        </button>
      )}
    </div>
  );
}

// ---------- market maths ----------

export function MathsGame({ household, level, onResult }: GameProps) {
  const currency = currencyFor(household);
  const [round, setRound] = useState<MathsRound>(() => mathsRound(level, currency));
  const [picked, setPicked] = useState<number | null>(null);
  const lang = household.elder.language;

  useEffect(() => {
    speak(round.question, household);
  }, [round, household]);

  const choose = (n: number) => {
    if (picked !== null) return;
    setPicked(n);
    const right = n === round.answer;
    speak(`${right ? praise(lang) : encourage(lang)} ${round.answer} ${currency}.`, household);
    onResult(right ? 1 : 0);
  };

  return (
    <div className="game">
      <p className="game__prompt">{round.question}</p>
      <div className="choices choices--numbers">
        {round.choices.map((n) => (
          <button
            key={n}
            className={`choice-btn${picked !== null && n === round.answer ? " choice-btn--right" : ""}${picked === n && n !== round.answer ? " choice-btn--tried" : ""}`}
            onClick={() => choose(n)}
          >
            {n} <span className="choice-btn__unit">{currency}</span>
          </button>
        ))}
      </div>
      {picked !== null && (
        <button className="big-button big-button--primary" onClick={() => { setPicked(null); setRound(mathsRound(level, currency)); }}>
          {t(household, "Next one", "Inayofuata")}
        </button>
      )}
    </div>
  );
}

// ---------- drum memory ----------

const DRUM_NAMES = { en: ["red", "yellow", "green", "blue"], sw: ["nyekundu", "njano", "kijani", "bluu"] };

export function DrumGame({ household, level, onResult }: GameProps) {
  const [seq, setSeq] = useState<number[]>(() => drumStart(level));
  const [phase, setPhase] = useState<"ready" | "listen" | "play" | "rest">("ready");
  const [lit, setLit] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [best, setBest] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lang = household.elder.language;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const playSeq = (s: number[]) => {
    setPhase("listen");
    setPos(0);
    s.forEach((d, i) => {
      timers.current.push(
        setTimeout(() => {
          setLit(d);
          drum(d);
        }, 700 + i * 900),
        setTimeout(() => setLit(null), 700 + i * 900 + 500),
      );
    });
    timers.current.push(setTimeout(() => setPhase("play"), 700 + s.length * 900));
  };

  const tap = (d: number) => {
    if (phase !== "play") return;
    drum(d);
    setLit(d);
    timers.current.push(setTimeout(() => setLit(null), 250));
    if (d !== seq[pos]) {
      setPhase("rest");
      speak(t(household, "Nearly! Let's listen again.", "Karibu! Tusikilize tena."), household, () => playSeq(seq));
      onResult(Math.min(1, best / (seq.length + 2)));
      return;
    }
    if (pos + 1 < seq.length) return setPos(pos + 1);
    setBest(Math.max(best, seq.length));
    const longer = drumNext(seq);
    setSeq(longer);
    setPhase("rest");
    speak(praise(lang), household, () => playSeq(longer));
    if (longer.length > 7) onResult(1);
  };

  return (
    <div className="game">
      <p className="game__prompt">
        {phase === "ready"
          ? t(household, "Listen to the drums, then tap them in the same order.", "Sikiliza ngoma, kisha uzigonge kwa mpangilio uleule.")
          : phase === "listen"
            ? t(household, "Listen…", "Sikiliza…")
            : phase === "play"
              ? t(household, "Your turn", "Zamu yako")
              : "…"}
      </p>
      <div className="drums" aria-label={t(household, "Drums", "Ngoma")}>
        {Array.from({ length: DRUMS }, (_, d) => (
          <button
            key={d}
            className={`drum drum--${d}${lit === d ? " drum--lit" : ""}`}
            onClick={() => tap(d)}
            aria-label={DRUM_NAMES[lang][d]}
          />
        ))}
      </div>
      {phase === "ready" && (
        <button className="big-button big-button--primary" onClick={() => playSeq(seq)}>
          {t(household, "Start", "Anza")}
        </button>
      )}
      {best > 0 && <p className="game__note">{t(household, `Longest so far: ${best}`, `Ndefu zaidi: ${best}`)}</p>}
    </div>
  );
}
