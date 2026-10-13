import { handlePushAck } from "../server/handlers.js";
import { vercel } from "../server/vercel.js";

export default vercel(handlePushAck);
