// The webhook tools the Kinly agent can call. Each one is served by
// server/handlers.ts at /api/tools/<name>.
export const TOOLS = [
  {
    "name": "get_reminders",
    "description": "Get today's medication and meal reminders with their ids and status (upcoming, due, taken, missed). Use before confirming a reminder.",
    "properties": {}
  },
  {
    "name": "confirm_reminder",
    "description": "Log that the person has taken a medication or eaten a meal. Only call after they clearly say they have done it.",
    "properties": {
      "reminder_id": {
        "type": "string",
        "description": "The reminder id from get_reminders or the reminder list in the prompt."
      }
    },
    "required": [
      "reminder_id"
    ]
  },
  {
    "name": "get_family_messages",
    "description": "Get unread messages the family typed for the person. Read each one aloud. They are marked as heard.",
    "properties": {}
  },
  {
    "name": "send_family_message",
    "description": "Send a message the person spoke to a family member. Confirm the recipient and wording with them first.",
    "properties": {
      "family_name": {
        "type": "string",
        "description": "First name of the family member, e.g. Esi."
      },
      "message": {
        "type": "string",
        "description": "The message, in the person's own words."
      }
    },
    "required": [
      "family_name",
      "message"
    ]
  },
  {
    "name": "raise_alert",
    "description": "Alert the family circle immediately. Use for falls, pain, feeling unwell, distress, confusion, or any request for help. Do not hesitate.",
    "properties": {
      "reason": {
        "type": "string",
        "description": "Short factual reason, quoting what the person said."
      }
    },
    "required": [
      "reason"
    ]
  }
] as const;
