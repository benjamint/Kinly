import type { Household, HouseholdAction, Reminder, ReminderLog } from "./types";

/** How long after its time a reminder counts as "due" before it is logged as missed. */
export const MISSED_AFTER_MINUTES = 30;
/** Keep the history bounded so the household document stays small. */
const MAX_LOGS = 500;
const MAX_MESSAGES = 200;
const MAX_ALERTS = 100;

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Local date ("YYYY-MM-DD") and minutes-since-midnight for `now` in `timeZone`. */
export function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isQuietTime(household: Household, now: Date): boolean {
  const { minutes } = localClock(now, household.elder.timezone);
  const start = toMinutes(household.elder.quietHours.start);
  const end = toMinutes(household.elder.quietHours.end);
  // Window may wrap past midnight (e.g. 21:30 – 06:30).
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export type TodayStatus = "taken" | "missed" | "due" | "upcoming";

export interface TodayReminder {
  reminder: Reminder;
  date: string;
  status: TodayStatus;
  log?: ReminderLog;
}

/** Today's active reminders in time order, with their status for today. */
export function todaysReminders(household: Household, now: Date): TodayReminder[] {
  const { date, minutes } = localClock(now, household.elder.timezone);
  return household.reminders
    .filter((r) => r.active)
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
    .map((reminder) => {
      const log = household.logs.find((l) => l.reminderId === reminder.id && l.date === date);
      let status: TodayStatus;
      const late = minutes - toMinutes(reminder.time);
      if (log) status = log.status;
      else if (late < 0) status = "upcoming";
      else if (late < MISSED_AFTER_MINUTES) status = "due";
      else status = "missed";
      return { reminder, date, status, log };
    });
}

/**
 * Reminders past the missed window with nothing logged yet, which should be
 * logged as missed (and alert family). Reminders that fell due before Kinly
 * was set up are left alone, so a new household doesn't start with alarms.
 */
export function overdueReminders(household: Household, now: Date): TodayReminder[] {
  const created = household.createdAt ? localClock(new Date(household.createdAt), household.elder.timezone) : null;
  return todaysReminders(household, now).filter(
    (t) =>
      t.status === "missed" &&
      !t.log &&
      !(created && created.date === t.date && created.minutes > toMinutes(t.reminder.time)),
  );
}

export function unreadFamilyMessages(household: Household) {
  return household.messages.filter((m) => m.direction === "family" && !m.readAt);
}

export function openAlerts(household: Household) {
  return household.alerts.filter((a) => !a.acknowledgedAt);
}

function upsertLog(logs: ReminderLog[], log: Omit<ReminderLog, "id">): ReminderLog[] {
  const rest = logs.filter((l) => !(l.reminderId === log.reminderId && l.date === log.date));
  return [...rest, { id: newId(), ...log }].slice(-MAX_LOGS);
}

/**
 * Pure state transition shared by every client and the server, so a reminder
 * confirmed by voice, by tap, or over a phone call all land the same way.
 */
export function applyAction(
  household: Household,
  action: HouseholdAction,
  now: Date = new Date(),
): Household {
  const at = now.toISOString();
  switch (action.type) {
    case "confirmReminder":
      return {
        ...household,
        logs: upsertLog(household.logs, {
          reminderId: action.reminderId,
          date: action.date,
          status: "taken",
          at,
        }),
      };
    case "markMissed": {
      const existing = household.logs.find(
        (l) => l.reminderId === action.reminderId && l.date === action.date,
      );
      if (existing) return household; // never overwrite a confirmation
      const reminder = household.reminders.find((r) => r.id === action.reminderId);
      return {
        ...household,
        logs: upsertLog(household.logs, {
          reminderId: action.reminderId,
          date: action.date,
          status: "missed",
          at,
        }),
        alerts:
          reminder?.kind === "medication"
            ? [
                ...household.alerts,
                {
                  id: newId(),
                  source: "missed" as const,
                  reason: `${household.elder.name} has not confirmed their ${reminder.label} (${reminder.time}).`,
                  at,
                },
              ].slice(-MAX_ALERTS)
            : household.alerts,
      };
    }
    case "saveReminder": {
      const exists = household.reminders.some((r) => r.id === action.reminder.id);
      return {
        ...household,
        reminders: exists
          ? household.reminders.map((r) => (r.id === action.reminder.id ? action.reminder : r))
          : [...household.reminders, action.reminder],
      };
    }
    case "deleteReminder":
      return {
        ...household,
        reminders: household.reminders.filter((r) => r.id !== action.reminderId),
      };
    case "familyMessage":
    case "elderMessage":
      return {
        ...household,
        messages: [
          ...household.messages,
          {
            id: newId(),
            direction: action.type === "familyMessage" ? ("family" as const) : ("elder" as const),
            familyName: action.familyName,
            text: action.text.trim(),
            at,
          },
        ].slice(-MAX_MESSAGES),
      };
    case "markMessagesRead":
      return {
        ...household,
        messages: household.messages.map((m) =>
          action.ids.includes(m.id) && !m.readAt ? { ...m, readAt: at } : m,
        ),
      };
    case "raiseAlert":
      return {
        ...household,
        alerts: [
          ...household.alerts,
          { id: newId(), source: action.source, reason: action.reason, at },
        ].slice(-MAX_ALERTS),
      };
    case "acknowledgeAlert":
      return {
        ...household,
        alerts: household.alerts.map((a) =>
          a.id === action.alertId && !a.acknowledgedAt
            ? { ...a, acknowledgedAt: at, acknowledgedBy: action.by }
            : a,
        ),
      };
    case "updateElder":
      return { ...household, elder: { ...household.elder, ...action.patch } };
    case "saveFamilyMember": {
      const exists = household.family.some((f) => f.id === action.member.id);
      return {
        ...household,
        family: exists
          ? household.family.map((f) => (f.id === action.member.id ? action.member : f))
          : [...household.family, action.member],
      };
    }
    case "deleteFamilyMember":
      return { ...household, family: household.family.filter((f) => f.id !== action.memberId) };
  }
}

/** A friendly starting household so the prototype has something to show. */
export function demoHousehold(id = "demo", timezone = "Africa/Accra"): Household {
  return {
    id,
    createdAt: new Date().toISOString(),
    elder: {
      name: "Ama",
      language: "en",
      timezone,
      speechSpeed: 0.9,
      captionScale: 1,
      showCaptions: true,
      quietHours: { start: "21:30", end: "06:30" },
    },
    family: [
      { id: "f-esi", name: "Esi", relation: "daughter" },
      { id: "f-kofi", name: "Kofi", relation: "son" },
    ],
    reminders: [
      {
        id: "r-bp",
        kind: "medication",
        label: "blood pressure tablet",
        time: "08:00",
        instructions: "One tablet with water, after breakfast.",
        active: true,
      },
      { id: "r-lunch", kind: "meal", label: "lunch", time: "13:00", active: true },
      {
        id: "r-diabetes",
        kind: "medication",
        label: "evening metformin",
        time: "19:00",
        instructions: "One tablet with dinner.",
        active: true,
      },
    ],
    logs: [],
    messages: [
      {
        id: "m-welcome",
        direction: "family",
        familyName: "Esi",
        text: "Good morning Mama! I will visit on Sunday with the children.",
        at: new Date().toISOString(),
      },
    ],
    alerts: [],
  };
}

/** Plain-language summary handed to the voice agent at the start of a conversation. */
export function agentContext(household: Household, now: Date = new Date()) {
  const today = todaysReminders(household, now);
  const reminders = today
    .map(
      (t) =>
        `- [${t.reminder.id}] ${t.reminder.time} ${t.reminder.kind}: ${t.reminder.label}` +
        (t.reminder.instructions ? ` (instructions: "${t.reminder.instructions}")` : "") +
        ` — ${t.status}`,
    )
    .join("\n");
  const unread = unreadFamilyMessages(household);
  return {
    household_id: household.id,
    elder_name: household.elder.name,
    family_names: household.family.map((f) => `${f.name} (${f.relation})`).join(", ") || "none",
    todays_reminders: reminders || "No reminders today.",
    unread_message_count: unread.length,
    local_time: new Intl.DateTimeFormat("en-GB", {
      timeZone: household.elder.timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(now),
  };
}
