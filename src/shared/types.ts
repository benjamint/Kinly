// Shared data model for one Kinly household. The same shape is used by the
// elder screen, the family dashboard, the API, and the voice agent's tools.

export type Language = "en" | "sw";

export interface ElderSettings {
  name: string;
  language: Language;
  /** IANA time zone the reminder times are written in, e.g. "Africa/Accra". */
  timezone: string;
  /** Speech rate for Kinly's voice, 0.7 (slow) – 1.2 (fast). */
  speechSpeed: number;
  /** Caption text multiplier, 1 – 2. */
  captionScale: number;
  showCaptions: boolean;
  /** Local "HH:MM" window in which Kinly stays quiet. */
  quietHours: { start: string; end: string };
}

export interface FamilyMember {
  id: string;
  name: string;
  relation: string;
}

export type ReminderKind = "medication" | "meal";

export interface Reminder {
  id: string;
  kind: ReminderKind;
  /** What Kinly says, e.g. "blood pressure tablet". */
  label: string;
  /** Local time "HH:MM" in the elder's time zone. */
  time: string;
  /** Exact instruction set by family or pharmacist; read verbatim, never improvised. */
  instructions?: string;
  active: boolean;
}

export type ReminderStatus = "taken" | "missed";

export interface ReminderLog {
  id: string;
  reminderId: string;
  /** Local date "YYYY-MM-DD" the reminder was for. */
  date: string;
  status: ReminderStatus;
  at: string;
}

export interface Message {
  id: string;
  /** "family" = typed by family and read aloud; "elder" = spoken by the elder and transcribed. */
  direction: "family" | "elder";
  /** Family member the message is from (family) or to (elder). */
  familyName: string;
  text: string;
  at: string;
  readAt?: string;
}

export type AlertSource = "button" | "voice" | "missed";

export interface Alert {
  id: string;
  source: AlertSource;
  reason: string;
  at: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

export interface Household {
  id: string;
  /** When Kinly started looking after this household; earlier reminders are never reported missed. */
  createdAt?: string;
  elder: ElderSettings;
  family: FamilyMember[];
  reminders: Reminder[];
  logs: ReminderLog[];
  messages: Message[];
  alerts: Alert[];
  /** Server-only: family phones subscribed to push alerts. Never sent to browsers. */
  push?: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    familyName: string;
    createdAt: string;
  }[];
}

export type HouseholdAction =
  | { type: "confirmReminder"; reminderId: string; date: string }
  | { type: "markMissed"; reminderId: string; date: string }
  | { type: "saveReminder"; reminder: Reminder }
  | { type: "deleteReminder"; reminderId: string }
  | { type: "familyMessage"; familyName: string; text: string }
  | { type: "elderMessage"; familyName: string; text: string }
  | { type: "markMessagesRead"; ids: string[] }
  | { type: "raiseAlert"; source: AlertSource; reason: string }
  | { type: "acknowledgeAlert"; alertId: string; by: string }
  | { type: "updateElder"; patch: Partial<ElderSettings> }
  | { type: "saveFamilyMember"; member: FamilyMember }
  | { type: "deleteFamilyMember"; memberId: string };
