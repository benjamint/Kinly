import { useCallback, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import type { Household } from "../shared/types";
import { fetchSession, type Connection } from "./household-context";
import type { StartOptions, VoiceEngine, VoiceState } from "./voice";

/**
 * Live voice through the ElevenLabs agent (speech-to-text → Claude → voice).
 * The agent's tools are server webhooks, so after any tool call we ask the
 * household to refresh and the screen catches up straight away.
 */
export function useElevenLabsVoice(
  connection: Connection | null,
  household: Household | null,
  onToolDone: () => void,
): VoiceEngine {
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const onToolDoneRef = useRef(onToolDone);
  onToolDoneRef.current = onToolDone;
  // Told to the agent as soon as the session connects (e.g. "Help was pressed").
  const pendingContext = useRef<string | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      const note = pendingContext.current;
      pendingContext.current = null;
      if (note) conversationRef.current?.sendContextualUpdate(note);
    },
    onMessage: (m) => {
      if (m.role === "agent") {
        setCaption(m.message);
        setThinking(false);
      } else {
        setHeard(m.message);
        setThinking(true);
      }
    },
    onModeChange: ({ mode }) => mode === "speaking" && setThinking(false),
    onAgentToolRequest: (t) => setActiveTool(t.tool_name),
    onAgentToolResponse: () => {
      setActiveTool(null);
      onToolDoneRef.current();
    },
    onError: (message) => setError(String(message)),
    onDisconnect: () => {
      setThinking(false);
      setActiveTool(null);
    },
  });
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const start = useCallback(
    async (options: StartOptions = {}) => {
      if (!connection || !household) return;
      setError(null);
      setStarting(true);
      pendingContext.current = options.context ?? null;
      try {
        // Starting something new (Help, a reminder) while a conversation is on:
        // end it first so the new one opens with the right first words.
        if (conversation.status === "connected" || conversation.status === "connecting") {
          conversation.endSession();
          await new Promise((r) => setTimeout(r, 400));
        }
        // The browser must grant the microphone before the session starts.
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const { token, dynamicVariables } = await fetchSession(connection);
        conversation.startSession({
          conversationToken: token,
          connectionType: "webrtc",
          dynamicVariables,
          overrides: {
            agent: {
              language: household.elder.language,
              ...(options.firstMessage ? { firstMessage: options.firstMessage } : {}),
            },
            tts: { speed: household.elder.speechSpeed },
          },
        });
      } catch (e) {
        setError((e as Error).message || "Could not start the conversation.");
      } finally {
        setStarting(false);
      }
    },
    [connection, household, conversation],
  );

  let state: VoiceState;
  if (error) state = "error";
  else if (starting || conversation.status === "connecting") state = "connecting";
  else if (conversation.status !== "connected") state = "idle";
  else if (conversation.isSpeaking) state = "speaking";
  else if (thinking || activeTool) state = "thinking";
  else state = "listening";

  return {
    state,
    caption,
    heard,
    error,
    activeTool,
    start: (o) => void start(o),
    stop: () => conversation.endSession(),
    getVolume: () => (conversation.status === "connected" ? conversation.getOutputVolume() : 0),
  };
}
