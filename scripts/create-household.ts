// Creates a household in Supabase with the demo reminders, ready to join.
//
//   npm run create-household -- <code> <pin> [elder name] [time zone]
//   npm run create-household -- mama-ama 482913 Ama Africa/Accra
import { loadEnv } from "vite";
import { demoHousehold } from "../src/shared/household.js";
import { sha256, SupabaseStore } from "../server/store.js";

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const [id, pin, name = "Ama", timezone = "Africa/Accra"] = process.argv.slice(2);

if (!id || !/^[a-z0-9-]{3,40}$/.test(id) || !pin || !/^\d{6,}$/.test(pin)) {
  console.error("Usage: npm run create-household -- <code: a-z 0-9 -> <pin: 6+ digits> [name] [time zone]");
  process.exit(1);
}
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.");
  process.exit(1);
}

const store = new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const household = demoHousehold(id, timezone);
household.elder.name = name;
await store.create(household, await sha256(`${id}:${pin}`));
console.log(`Household "${id}" is ready. Join it on the tablet with code ${id} and your PIN.`);
