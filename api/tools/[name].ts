import { handleTool } from "../../server/handlers.js";
import { vercel } from "../../server/vercel.js";

export default vercel((env, req) => handleTool(env, req.query.name ?? "", req));
