import { useEffect, useRef, useState } from "react";
import { EXERCISES } from "../../shared/activities";
import type { Household } from "../../shared/types";
import { speak, stopSpeaking } from "../speak";

// Gentle seated exercises, one at a time, with a counted ring and spoken
// counting. Slow, optional, and always "stop if anything hurts".

export function Exercises({ household, onFinished }: { household: Household; onFinished: (completed: number) => void }) {
  const lang = household.elder.language;
  const sw = lang === "sw";
  const [index, setIndex] = useState(0);
  const [rep, setRep] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const ex = EXERCISES[index];
  const finished = index >= EXERCISES.length;

  useEffect(() => () => {
    clearInterval(timer.current);
    stopSpeaking();
  }, []);

  useEffect(() => {
    if (finished) {
      onFinished(EXERCISES.length);
      speak(sw ? "Umemaliza! Hongera sana." : "All done! Well done, that was lovely.", household);
      return;
    }
    setRep(0);
    setRunning(false);
    speak(`${ex.title[lang]}. ${ex.how[lang]}`, household);
  }, [index]);

  const start = () => {
    setRunning(true);
    let r = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      r += 1;
      setRep(r);
      speak(String(r), household);
      if (r >= ex.reps) {
        clearInterval(timer.current);
        setRunning(false);
        setTimeout(() => setIndex((i) => i + 1), 1500);
      }
    }, ex.secondsEach * 1000);
  };

  if (finished) {
    return (
      <div className="exercise exercise--done">
        <p className="exercise__emoji" aria-hidden="true">🌟</p>
        <p className="game__prompt">{sw ? "Umemaliza! Hongera sana." : "All done! Well done."}</p>
        <button className="big-button big-button--primary" onClick={() => setIndex(0)}>
          {sw ? "Anza tena" : "Start again"}
        </button>
      </div>
    );
  }

  const progress = rep / ex.reps;
  return (
    <div className="exercise">
      <p className="exercise__step">
        {index + 1} / {EXERCISES.length}
      </p>
      <div className="exercise__ring" style={{ ["--p" as string]: progress }}>
        <span className="exercise__emoji" aria-hidden="true">{ex.emoji}</span>
        <span className="exercise__count">
          {rep} / {ex.reps}
        </span>
      </div>
      <h2 className="exercise__title">{ex.title[lang]}</h2>
      <p className="exercise__how">{ex.how[lang]}</p>
      <div className="exercise__actions">
        {!running && (
          <button className="big-button big-button--primary" onClick={start}>
            {rep === 0 ? (sw ? "Anza" : "Start") : sw ? "Endelea" : "Continue"}
          </button>
        )}
        <button className="big-button" onClick={() => setIndex((i) => i + 1)}>
          {sw ? "Ruka" : "Skip"}
        </button>
      </div>
      <p className="exercise__safety">
        {sw ? "Acha mara moja kama kitu kinauma." : "Stop straight away if anything hurts."}
      </p>
    </div>
  );
}
