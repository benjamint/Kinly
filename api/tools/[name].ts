import { handleTool } from "../../server/handlers";
import { vercel } from "../../server/vercel";

export default vercel((env, req) => handleTool(env, req.query.name ?? "", req));
