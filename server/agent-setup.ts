import { SYSTEM_PROMPT } from "../agent/prompt.js";
import { TOOLS } from "../agent/tools.js";

// Creates or updates the Kinly agent and its webhook tools in ElevenLabs.
// Runs inside the deployed app (the "Set up Kinly's voice" button on the
// family dashboard) and from `npm run sync-agent`, so nobody has to copy
// prompts or ids between dashboards.

const API = "https://api.elevenlabs.io/v1/convai";
export const AGENT_NAME = "Kinly";

interface ToolDef {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required?: string[];
}

export interface AgentSetupOptions {
  apiKey: string;
  /** Public base URL of the deployed app, used for the tool webhooks. */
  publicUrl: string;
  toolSecret: string;
  llm?: string;
  voiceId?: string;
  ttsModel?: string;
  fetch?: typeof fetch;
}

function client(apiKey: string, f: typeof fetch) {
  return async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(`${API}${path}`, {
      method,
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ElevenLabs ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  };
}

function toolConfig(t: ToolDef, publicUrl: string, toolSecret: string) {
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

/** Finds the Kinly agent by name. Returns null if it hasn't been created yet. */
export async function findAgentId(apiKey: string, f: typeof fetch = fetch): Promise<string | null> {
  const call = client(apiKey, f);
  const res = await call<{ agents?: { agent_id: string; name: string }[] }>(
    "GET",
    `/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=100`,
  );
  return res.agents?.find((a) => a.name === AGENT_NAME)?.agent_id ?? null;
}

/** Creates the agent and tools, or updates them if they already exist. Returns the agent id. */
export async function setupAgent(o: AgentSetupOptions): Promise<{ agentId: string; created: boolean }> {
  const f = o.fetch ?? fetch;
  const call = client(o.apiKey, f);
  const publicUrl = o.publicUrl.replace(/\/$/, "");

  const existing = await call<{ tools?: { id: string; tool_config: { name: string } }[] }>("GET", "/tools");
  const toolIds: string[] = [];
  for (const t of TOOLS as readonly ToolDef[]) {
    const config = { tool_config: toolConfig(t, publicUrl, o.toolSecret) };
    const found = existing.tools?.find((x) => x.tool_config.name === t.name);
    if (found) {
      await call("PATCH", `/tools/${found.id}`, config);
      toolIds.push(found.id);
    } else {
      toolIds.push((await call<{ id: string }>("POST", "/tools", config)).id);
    }
  }

  const agent = {
    name: AGENT_NAME,
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
          prompt: SYSTEM_PROMPT,
          llm: o.llm || "claude-sonnet-4-5",
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
        voice_id: o.voiceId || "21m00Tcm4TlvDq8ikWAM",
        // ElevenLabs requires English agents to use an English model (flash/turbo v2).
        model_id: o.ttsModel || "eleven_flash_v2",
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

  const agentId = await findAgentId(o.apiKey, f);
  if (agentId) {
    await call("PATCH", `/agents/${agentId}`, agent);
    return { agentId, created: false };
  }
  const created = await call<{ agent_id: string }>("POST", "/agents/create", agent);
  return { agentId: created.agent_id, created: true };
}
