import { localClock, todaysReminders, unreadFamilyMessages } from "../shared/household";
import type { Household, HouseholdAction } from "../shared/types";

// A tiny rule-based stand-in for the real agent, used when ElevenLabs isn't
// configured. It covers the same jobs (reminders, messages, help) so the
// prototype can be tried on any phone with no keys. It is deliberately
// cautious: it never improvises about health.

export interface BrainContext {
  /** Reminder the current conversation is about, if Kinly raised one. */
  reminderId?: string;
  /** Waiting for the text of a message to this family member. */
  composingTo?: string;
  /** Kinly asked who the message is for. */
  askingWho?: boolean;
}

export interface BrainReply {
  say: string;
  actions: HouseholdAction[];
  context: BrainContext;
  /** End the conversation after speaking. */
  end?: boolean;
}

const HELP = /\b(help|emergency|ambulance|pain|hurts?|fell|fallen|dizzy|can'?t breathe|chest|msaada|nisaidie)\b/i;
const YES = /\b(yes|yeah|yep|done|taken|took|had it|ate|eaten|i have|ndiyo|nimekunywa|nimekula|nimemeza)\b/i;
const NO = /\b(no|not yet|later|hapana|bado)\b/i;
const BYE = /\b(bye|goodbye|good night|leave me|stop|that'?s all|nothing|thank you|thanks|asante|kwaheri)\b/i;
const MESSAGES = /\b(messages?|news|anything from|ujumbe)\b/i;
const REMINDERS = /\b(reminders?|medicines?|medication|tablets?|pills?|dawa|schedule)\b/i;
const TELL = /\b(?:tell|message|send(?: a message)? to|ask)\s+([a-z]+)\b(?:\s+(?:that|to))?\s*(.*)$/i;

export function greeting(household: Household): string {
  const unread = unreadFamilyMessages(household).length;
  const sw = household.elder.language === "sw";
  const name = household.elder.name;
  if (sw) {
    return unread
      ? `Habari ${name}. Una ujumbe ${unread} kutoka kwa familia. Ungependa niusome?`
      : `Habari ${name}. Mimi ni Kinly, msaidizi wako. Naweza kukusaidiaje leo?`;
  }
  return unread
    ? `Hello ${name}, it's Kinly. You have ${unread === 1 ? "a new message" : `${unread} new messages`} from your family. Would you like me to read ${unread === 1 ? "it" : "them"}?`
    : `Hello ${name}, it's Kinly. How are you feeling today?`;
}

export function reminderPrompt(household: Household, reminderId: string): string {
  const r = household.reminders.find((x) => x.id === reminderId);
  if (!r) return greeting(household);
  const name = household.elder.name;
  if (household.elder.language === "sw") {
    return r.kind === "medication"
      ? `${name}, ni wakati wa ${r.label}. ${r.instructions ?? ""} Umeshameza?`
      : `${name}, ni wakati wa ${r.label}. Umekula?`;
  }
  return r.kind === "medication"
    ? `${name}, it's time for your ${r.label}. ${r.instructions ?? ""} Have you taken it?`
    : `${name}, it's time for ${r.label}. Have you eaten?`;
}

export function whoPrompt(household: Household): string {
  const names = household.family.map((f) => f.name).join(" or ");
  return household.elder.language === "sw"
    ? `Ungependa kumtumia nani ujumbe? ${names}?`
    : `Who would you like to send a message to? ${names}?`;
}

function readMessages(household: Household): BrainReply {
  const unread = unreadFamilyMessages(household);
  if (!unread.length) {
    return { say: "There are no new messages right now.", actions: [], context: {} };
  }
  const said = unread.map((m) => `${m.familyName} says: ${m.text}`).join(" ... ");
  return {
    say: `${said} ... Would you like to reply?`,
    actions: [{ type: "markMessagesRead", ids: unread.map((m) => m.id) }],
    context: { composingTo: unread[unread.length - 1].familyName },
  };
}

export function respond(
  household: Household,
  heard: string,
  context: BrainContext,
  now: Date = new Date(),
): BrainReply {
  const text = heard.trim();
  const familyNames = household.family.map((f) => f.name);
  const allFamily = familyNames.join(" and ") || "your family";

  // Safety first: anything that sounds like distress goes to the family.
  if (HELP.test(text)) {
    return {
      say: `I'm letting ${allFamily} know right now that you need help. Stay where you are, I'm here with you. If it's serious, please call for emergency help too.`,
      actions: [{ type: "raiseAlert", source: "voice", reason: `${household.elder.name} said: "${text}"` }],
      context: {},
    };
  }

  if (context.reminderId) {
    const r = household.reminders.find((x) => x.id === context.reminderId);
    const { date } = localClock(now, household.elder.timezone);
    if (r && YES.test(text) && !NO.test(text)) {
      return {
        say: `Wonderful, thank you. I've noted your ${r.label} for ${allFamily}. Is there anything else?`,
        actions: [{ type: "confirmReminder", reminderId: r.id, date }],
        context: {},
      };
    }
    if (r && NO.test(text)) {
      return {
        say: `That's alright. Please take it when you can, and tell me when it's done.`,
        actions: [],
        context,
        end: true,
      };
    }
  }

  if (context.composingTo) {
    if (NO.test(text) && text.split(/\s+/).length <= 3) {
      return { say: "Alright. Is there anything else?", actions: [], context: {} };
    }
    if (YES.test(text) && text.split(/\s+/).length <= 3) {
      return { say: `What would you like me to tell ${context.composingTo}?`, actions: [], context };
    }
    return {
      say: `I'll send that to ${context.composingTo}: "${text}". Anything else?`,
      actions: [{ type: "elderMessage", familyName: context.composingTo, text }],
      context: {},
    };
  }

  if (context.askingWho) {
    const who = familyNames.find((n) => new RegExp(`\\b${n}\\b`, "i").test(text));
    if (who) return { say: `What would you like me to tell ${who}?`, actions: [], context: { composingTo: who } };
  }

  const tell = text.match(TELL);
  if (tell) {
    const who = familyNames.find((n) => n.toLowerCase() === tell[1].toLowerCase());
    if (who) {
      if (tell[2].trim()) {
        return {
          say: `I'll tell ${who}: "${tell[2].trim()}". Anything else?`,
          actions: [{ type: "elderMessage", familyName: who, text: tell[2].trim() }],
          context: {},
        };
      }
      return { say: `What would you like me to tell ${who}?`, actions: [], context: { composingTo: who } };
    }
  }

  if (MESSAGES.test(text) || (YES.test(text) && unreadFamilyMessages(household).length)) {
    return readMessages(household);
  }

  if (REMINDERS.test(text)) {
    const left = todaysReminders(household, now).filter((t) => t.status === "upcoming" || t.status === "due");
    if (!left.length) {
      return { say: "You're all done for today. Well done.", actions: [], context: {} };
    }
    const list = left.map((t) => `${t.reminder.label} at ${t.reminder.time}`).join(", then ");
    return { say: `Still to come today: ${list}.`, actions: [], context: {} };
  }

  if (BYE.test(text)) {
    return { say: "Alright. I'm right here whenever you need me.", actions: [], context: {}, end: true };
  }

  return {
    say: `I'm a practice version of Kinly, so I can't chat freely yet. I can read your messages, go through your reminders, send a message to ${allFamily}, or get help.`,
    actions: [],
    context: {},
  };
}
