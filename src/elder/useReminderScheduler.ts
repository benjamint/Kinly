import { useEffect, useRef } from "react";
import { isQuietTime, overdueReminders, todaysReminders } from "../shared/household";
import type { Household, HouseholdAction } from "../shared/types";
import { chime } from "./sound";

/** Re-ask after this many minutes, like the PRD's spaced re-dials. */
export const REPROMPT_MINUTES = 10;

export interface Prompt {
  reminderId: string;
  date: string;
}

/**
 * What the scheduler should do right now. Pure so it can be tested:
 * - prompt: a due reminder Kinly should bring up (first time, or a spaced re-ask)
 * - missed: reminders past the window with no confirmation
 */
export function schedulerStep(
  household: Household,
  now: Date,
  lastPrompted: Map<string, number>,
): { prompt: Prompt | null; missed: Prompt[] } {
  const missed = overdueReminders(household, now).map((t) => ({ reminderId: t.reminder.id, date: t.date }));
  let prompt: Prompt | null = null;
  for (const t of todaysReminders(household, now)) {
    if (t.status !== "due") continue;
    const key = `${t.reminder.id}:${t.date}`;
    const last = lastPrompted.get(key);
    const ready = last === undefined || now.getTime() - last >= REPROMPT_MINUTES * 60_000;
    if (!prompt && ready && !isQuietTime(household, now)) prompt = { reminderId: t.reminder.id, date: t.date };
  }
  return { prompt, missed };
}

/**
 * Runs on the elder's device. When a reminder comes due, Kinly chimes and
 * starts talking about it; unconfirmed reminders are logged as missed (and
 * medication misses alert the family).
 */
export function useReminderScheduler(
  household: Household | null,
  busy: boolean,
  dispatch: (...actions: HouseholdAction[]) => Promise<void>,
  onPrompt: (reminderId: string) => void,
) {
  const lastPrompted = useRef(new Map<string, number>());
  const state = useRef({ household, busy, dispatch, onPrompt });
  state.current = { household, busy, dispatch, onPrompt };

  useEffect(() => {
    const check = () => {
      const { household, busy, dispatch } = state.current;
      if (!household) return;
      const now = new Date();
      const { prompt, missed } = schedulerStep(household, now, lastPrompted.current);
      if (missed.length) {
        void dispatch(...missed.map((m) => ({ type: "markMissed" as const, ...m })));
      }
      if (prompt && !busy) {
        lastPrompted.current.set(`${prompt.reminderId}:${prompt.date}`, now.getTime());
        chime();
        // Let the chime land before Kinly speaks.
        setTimeout(() => state.current.onPrompt(prompt.reminderId), 1200);
      }
    };
    const first = setTimeout(check, 3000);
    const timer = setInterval(check, 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
}
