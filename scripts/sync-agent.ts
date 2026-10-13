// Creates or updates the Kinly agent from your own computer. You usually don't
// need this: the family dashboard has a "Set up Kinly's voice" button that
// does the same thing from the deployed app.
//
//   npm run sync-agent
//
// Needs in .env: ELEVENLABS_API_KEY, KINLY_PUBLIC_URL (your deployed site),
// KINLY_TOOL_SECRET. Optional: ELEVENLABS_VOICE_ID, ELEVENLABS_TTS_MODEL, KINLY_AGENT_LLM.
import { loadEnv } from "vite";
import { setupAgent } from "../server/agent-setup";

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
for (const name of ["ELEVENLABS_API_KEY", "KINLY_PUBLIC_URL", "KINLY_TOOL_SECRET"]) {
  if (!env[name]) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
}

setupAgent({
  apiKey: env.ELEVENLABS_API_KEY!,
  publicUrl: env.KINLY_PUBLIC_URL!,
  toolSecret: env.KINLY_TOOL_SECRET!,
  llm: env.KINLY_AGENT_LLM,
  voiceId: env.ELEVENLABS_VOICE_ID,
  ttsModel: env.ELEVENLABS_TTS_MODEL,
})
  .then(({ agentId, created }) => console.log(`${created ? "Created" : "Updated"} agent ${agentId}`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
