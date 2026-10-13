// The shape every voice engine exposes to the face. The face only cares what
// Kinly is doing right now and how loud it is speaking.

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export interface StartOptions {
  /** Overrides Kinly's opening line, e.g. for a reminder. */
  firstMessage?: string;
  /** Reminder this conversation is about, so a "yes" can confirm it. */
  reminderId?: string;
  /** Kinly opened by asking who to send a message to. */
  askingWho?: boolean;
  /** Kinly just read a message from this family member, so a reply goes to them. */
  replyTo?: string;
  /** Background for the live agent about why this conversation started. */
  context?: string;
  /** Help and reminders always get the live voice; "chat" counts against the daily limit. */
  purpose?: "help" | "reminder" | "chat";
}

export interface VoiceEngine {
  state: VoiceState;
  /** What Kinly is saying (or last said). */
  caption: string;
  /** What the person last said, if known. */
  heard: string;
  error: string | null;
  /** Name of a tool Kinly is using right now, e.g. "raise_alert". */
  activeTool: string | null;
  start: (options?: StartOptions) => void;
  stop: () => void;
  /** 0–1 loudness of Kinly's voice, read every animation frame. */
  getVolume: () => number;
}
