import { handleHousehold } from "../server/handlers";
import { vercel } from "../server/vercel";

export default vercel(handleHousehold);
