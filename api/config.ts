import { handleConfig } from "../server/handlers";
import { vercel } from "../server/vercel";

export default vercel((env) => handleConfig(env));
