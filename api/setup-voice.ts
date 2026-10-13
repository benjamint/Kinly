import { handleSetupVoice } from "../server/handlers.js";
import { vercel } from "../server/vercel.js";

// Setting up the agent makes ~8 ElevenLabs calls; allow more than the default time.
export const config = { maxDuration: 60 };

export default vercel(handleSetupVoice);
