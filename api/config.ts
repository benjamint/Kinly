import { handleConfig } from "../server/handlers.js";
import { vercel } from "../server/vercel.js";

export default vercel((env) => handleConfig(env));
