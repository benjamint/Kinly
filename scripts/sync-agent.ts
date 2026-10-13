// Creates or updates the Kinly agent in your ElevenLabs account from the files
// in agent/, so the agent's personality and tools live in git.
//
//   npm run sync-agent
//
// Needs in .env: ELEVENLABS_API_KEY, KINLY_PUBLIC_URL (your deployed site),
// KINLY_TOOL_SECRET. Optional: ELEVENLABS_AGENT_ID (update instead of create),
// ELEVENLABS_VOICE_ID, ELEVENLABS_TTS_MODEL, KINLY_AGENT_LLM.
import { readFileSync } from "node:fs";
import { loadEnv } from "vite";

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const API = "https://api.elevenlabs.io/v1/convai";

function need(name: string): string {
  const v = env[name];
  if (!v) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
  return v;
}

const apiKey = need("ELEVENLABS_API_KEY");
const publicUrl = need("KINLY_PUBLIC_URL").replace(/\/$/, "");
const toolSecret = need("KINLY_TOOL_SECRET");

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface ToolDef {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required?: string[];
}

function toolConfig(t: ToolDef) {
  return {
    type: "webhook",
    name: t.name,
    description: t.description,
    response_timeout_secs: 10,
    api_schema: {
      url: `${publicUrl}/api/tools/${t.name}`,
      method: "POST",
      request_headers: { "x-kinly-tool-secret": toolSecret },
      request_body_schema: {
        type: "object",
        properties: {
          // Filled in by ElevenLabs from the session, never by the LLM.
          household_id: { type: "string", dynamic_variable: "household_id", description: "" },
          ...t.properties,
        },
        required: ["household_id", ...(t.required ?? [])],
      },
    },
  };
}

async function main() {
  const tools = JSON.parse(readFileSync("agent/tools.json", "utf8")) as ToolDef[];
  const prompt = readFileSync("agent/system-prompt.md", "utf8");

  // Upsert each webhook tool by name.
  const existing = await call<{ tools: { id: string; tool_config: { name: string } }[] }>("GET", "/tools");
  const toolIds: string[] = [];
  for (const t of tools) {
    const found = existing.tools.find((x) => x.tool_config.name === t.name);
    if (found) {
      await call("PATCH", `/tools/${found.id}`, { tool_config: toolConfig(t) });
      toolIds.push(found.id);
      console.log(`updated tool ${t.name}`);
    } else {
      const created = await call<{ id: string }>("POST", "/tools", { tool_config: toolConfig(t) });
      toolIds.push(created.id);
      console.log(`created tool ${t.name}`);
    }
  }

  const agent = {
    name: "Kinly",
    conversation_config: {
      agent: {
        first_message: "Hello {{elder_name}}, it's Kinly. How are you feeling today?",
        language: "en",
        dynamic_variables: {
          dynamic_variable_placeholders: {
            household_id: "demo",
            elder_name: "Ama",
            family_names: "Esi (daughter)",
            todays_reminders: "No reminders today.",
            unread_message_count: 0,
            local_time: "Monday 09:00",
          },
        },
        prompt: {
          prompt,
          llm: env.KINLY_AGENT_LLM ?? "claude-sonnet-4-5",
          temperature: 0.5,
          tool_ids: toolIds,
          built_in_tools: {
            end_call: {
              name: "end_call",
              description: "End the conversation when the person says goodbye or asks to be left alone.",
              params: { system_tool_type: "end_call" },
            },
          },
        },
      },
      tts: {
        voice_id: env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM",
        model_id: env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5",
      },
      turn: { turn_timeout: 12 }, // elders often pause; don't jump in too fast
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { first_message: true, language: true },
          tts: { speed: true },
        },
      },
    },
  };

  if (env.ELEVENLABS_AGENT_ID) {
    await call("PATCH", `/agents/${env.ELEVENLABS_AGENT_ID}`, agent);
    console.log(`updated agent ${env.ELEVENLABS_AGENT_ID}`);
  } else {
    const created = await call<{ agent_id: string }>("POST", "/agents/create", agent);
    console.log(`created agent ${created.agent_id}\nAdd ELEVENLABS_AGENT_ID=${created.agent_id} to .env and to Vercel.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
