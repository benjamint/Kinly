import { useEffect, useRef, useState } from "react";
import { useHousehold } from "../../lib/household-context";
import { levelFor } from "../../shared/activities";
import type { Game, Household } from "../../shared/types";
import { Sheet } from "../Sheets";
import { stopSpeaking } from "../speak";
import { Exercises } from "./Exercises";
import { DrumGame, MathsGame, PairsGame, ProverbGame } from "./Games";
import { TodayBoard } from "./TodayBoard";

// Free things to do with Kinly: no live AI voice, so no cost per use.

interface Tile {
  game: Game;
  emoji: string;
  en: string;
  sw: string;
}

const TILES: Tile[] = [
  { game: "today", emoji: "☀️", en: "Today", sw: "Leo" },
  { game: "pairs", emoji: "🃏", en: "Matching pairs", sw: "Tafuta jozi" },
  { game: "proverbs", emoji: "💬", en: "Finish the proverb", sw: "Maliza methali" },
  { game: "drums", emoji: "🥁", en: "Drum memory", sw: "Kumbuka ngoma" },
  { game: "maths", emoji: "🛒", en: "Market maths", sw: "Hesabu za sokoni" },
  { game: "exercises", emoji: "🪑", en: "Chair exercises", sw: "Mazoezi ya kitini" },
];

const label = (h: Household, tile: Tile) => (h.elder.language === "sw" ? tile.sw : tile.en);

export function ActivitiesSheet({
  household,
  onClose,
  onOpen,
}: {
  household: Household;
  onClose: () => void;
  onOpen: (game: Game) => void;
}) {
  const tiles = TILES.filter((t) => t.game !== "exercises" || household.elder.exercisesEnabled !== false);
  return (
    <Sheet title={household.elder.language === "sw" ? "Michezo" : "Activities"} onClose={onClose}>
      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.game} className="tile" onClick={() => onOpen(t.game)}>
            <span className="tile__emoji" aria-hidden="true">
              {t.emoji}
            </span>
            <span className="tile__label">{label(household, t)}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** One activity, full screen. Records how it went so levels adapt and family can see what was enjoyed. */
export function ActivityScreen({ household, game, onClose }: { household: Household; game: Game; onClose: () => void }) {
  const { dispatch } = useHousehold();
  const tile = TILES.find((t) => t.game === game)!;
  const [level] = useState(() => levelFor(game, household.activityLog));
  const started = useRef(Date.now());
  const scores = useRef<number[]>([]);

  const onResult = (score: number) => {
    scores.current.push(score);
  };

  // Log the visit when leaving (if it lasted long enough to count).
  const logRef = useRef(() => {});
  logRef.current = () => {
    const seconds = (Date.now() - started.current) / 1000;
    const s = scores.current;
    if (seconds < 10 && !s.length) return; // just a peek
    const score = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0.5;
    void dispatch({ type: "logActivity", result: { game, seconds, score, level } });
  };
  useEffect(
    () => () => {
      stopSpeaking();
      logRef.current();
    },
    [],
  );

  const props = { household, level, onResult };
  return (
    <Sheet title={label(household, tile)} onClose={onClose}>
      {game === "pairs" && <PairsGame {...props} />}
      {game === "proverbs" && <ProverbGame {...props} />}
      {game === "drums" && <DrumGame {...props} />}
      {game === "maths" && <MathsGame {...props} />}
      {game === "today" && <TodayBoard household={household} />}
      {game === "exercises" && <Exercises household={household} onFinished={(n) => onResult(n ? 1 : 0)} />}
    </Sheet>
  );
}
