import type { Household } from "../shared/types";

// The free voice: the phone's own speech. Used only by activities (games,
// Today board, exercises) so they cost nothing to run. Conversations, Help
// and messages use Kinly's live voice instead.

const LANG = { en: "en-GB", sw: "sw-KE" } as const;

export function speak(text: string, household: Household, onEnd?: () => void) {
  if (typeof speechSynthesis === "undefined") {
    onEnd?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = LANG[household.elder.language];
  u.rate = household.elder.speechSpeed;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith(u.lang.slice(0, 2)));
  if (voice) u.voice = voice;
  if (onEnd) u.onend = u.onerror = () => onEnd();
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
