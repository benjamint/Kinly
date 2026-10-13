import { useState } from "react";
import type { Household } from "../shared/types";
import { useLongPress } from "./useLongPress";

export const HELP_HOLD_MS = 1000;

export function HelpButton({ onHelp }: { onHelp: () => void }) {
  const [holding, setHolding] = useState(false);
  const press = useLongPress(onHelp, HELP_HOLD_MS, setHolding);
  return (
    <button
      className={`tool tool--help${holding ? " tool--holding" : ""}`}
      {...press}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onHelp()}
      aria-label="Help. Press and hold to alert your family."
    >
      <span className="tool__icon" aria-hidden="true">
        <svg viewBox="0 0 48 48"><path d="M24 42S6 31 6 18a9 9 0 0 1 18-2 9 9 0 0 1 18 2c0 13-18 24-18 24z" /></svg>
      </span>
      <span className="tool__label">{holding ? "Keep holding…" : "Help"}</span>
      <span className="tool__fill" aria-hidden="true" />
    </button>
  );
}

export function HelpOverlay({
  household,
  familyNames,
  onClose,
}: {
  household: Household;
  familyNames: string;
  onClose: () => void;
}) {
  // The most recent Help-button alert, so we can show when family has seen it.
  const alert = [...household.alerts].reverse().find((a) => a.source === "button");
  return (
    <div className="overlay overlay--help" role="alertdialog" aria-labelledby="help-title">
      <h1 id="help-title">Help is on the way</h1>
      <p>
        I've told <strong>{familyNames}</strong> that you need help.
      </p>
      <p className="overlay__status">
        {alert?.acknowledgedAt
          ? `${alert.acknowledgedBy ?? "Your family"} has seen this and is coming.`
          : "Waiting for them to answer…"}
      </p>
      <p className="overlay__small">If you are badly hurt or can't breathe, call emergency services too.</p>
      <button className="big-button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
