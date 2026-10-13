import { handleReminderCheck } from "../../server/handlers.js";
import { vercel } from "../../server/vercel.js";

export const config = { maxDuration: 60 };

export default vercel(handleReminderCheck);
