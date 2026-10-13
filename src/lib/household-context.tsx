import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { applyAction } from "../shared/household";
import type { Household, HouseholdAction } from "../shared/types";

// The household lives on the server (Supabase via /api), so the elder's
// tablet, the family's phones and the voice agent all share it. A device
// joins with the household code and PIN once and stays signed in until
// someone signs out.

export type Connection = { mode: "cloud"; id: string; pin: string };

interface ServerConfig {
  cloud: boolean;
  /** The ElevenLabs agent exists and live voice can be used. */
  voice: boolean;
  /** The key is set but the agent hasn't been created yet. */
  voiceSetupAvailable?: boolean;
  voiceError?: string;
  /** VAPID public key for push alerts, when the server can send them. */
  pushPublicKey?: string;
}

interface HouseholdContextValue {
  household: Household | null;
  connection: Connection | null;
  config: ServerConfig;
  error: string | null;
  dispatch: (...actions: HouseholdAction[]) => Promise<void>;
  connect: (connection: Connection) => Promise<void>;
  disconnect: () => void;
  /** Re-read the household now (e.g. after the voice agent changed it). */
  refresh: () => void;
  /** Create the Kinly agent in ElevenLabs from the deployed app. */
  setupVoice: () => Promise<void>;
  /** Authenticated POST to another household endpoint (e.g. "push"). */
  post: <T = unknown>(path: string, body: unknown) => Promise<T>;
}

const CONNECTION_KEY = "kinly.connection";
const OLD_DEMO_KEY = "kinly.household";
const POLL_MS = 5000;

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The saved sign-in, if it is a real household (old demo sign-ins are dropped). */
function savedConnection(): Connection | null {
  const saved = readJson<Partial<Connection>>(CONNECTION_KEY);
  if (saved?.mode === "cloud" && saved.id && saved.pin) return saved as Connection;
  writeJson(CONNECTION_KEY, null);
  writeJson(OLD_DEMO_KEY, null);
  return null;
}

const Ctx = createContext<HouseholdContextValue | null>(null);

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode); state stays in memory */
  }
}

async function api<T>(path: string, connection: Connection, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}?id=${encodeURIComponent(connection.id)}`, {
    method: body ? "POST" : "GET",
    headers: { "x-kinly-pin": connection.pin, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status}).`, res.status);
  return data as T;
}

export function fetchSession(connection: Connection) {
  return api<{ token: string; dynamicVariables: Record<string, string | number> }>("session", connection);
}

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ServerConfig>({ cloud: false, voice: false });
  const [connection, setConnection] = useState<Connection | null>(savedConnection);
  const [household, setHousehold] = useState<Household | null>(null);
  const [error, setError] = useState<string | null>(null);
  const householdRef = useRef(household);
  householdRef.current = household;
  const pullRef = useRef<() => void>(() => {});

  const loadConfig = useCallback(
    () =>
      fetch("/api/config")
        .then((r) => (r.ok ? r.json() : null))
        .then((c: ServerConfig | null) => c && setConfig(c))
        .catch(() => {
          /* offline: the sign-in screen explains */
        }),
    [],
  );
  useEffect(() => void loadConfig(), [loadConfig]);

  // Load + keep fresh.
  useEffect(() => {
    pullRef.current = () => {};
    if (!connection) return setHousehold(null);
    let cancelled = false;
    const pull = () =>
      api<Household>("household", connection)
        .then((h) => {
          if (!cancelled) {
            setHousehold(h);
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (cancelled) return;
          // The PIN was changed or the household removed: back to sign-in.
          if (e instanceof ApiError && e.status === 401) {
            writeJson(CONNECTION_KEY, null);
            setConnection(null);
          }
          setError(e.message);
        });
    pullRef.current = pull;
    pull();
    const timer = setInterval(pull, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connection]);

  const dispatch = useCallback(
    async (...actions: HouseholdAction[]) => {
      if (!connection || actions.length === 0) return;
      // Optimistic update, then take the server's answer as truth.
      const current = householdRef.current;
      if (current) setHousehold(actions.reduce((h, a) => applyAction(h, a), current));
      try {
        setHousehold(await api<Household>("household", connection, { actions }));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [connection],
  );

  const connect = useCallback(async (next: Connection) => {
    await api<Household>("household", next); // verify the code and PIN first
    setError(null);
    writeJson(CONNECTION_KEY, next);
    setConnection(next);
  }, []);

  const disconnect = useCallback(() => {
    writeJson(CONNECTION_KEY, null);
    setConnection(null);
  }, []);

  const refresh = useCallback(() => pullRef.current(), []);

  const post = useCallback(
    <T,>(path: string, body: unknown) => {
      if (!connection) return Promise.reject(new Error("Join a household first."));
      return api<T>(path, connection, body);
    },
    [connection],
  );

  const setupVoice = useCallback(async () => {
    if (!connection) throw new Error("Join a household first.");
    await api("setup-voice", connection, {});
    await loadConfig();
  }, [connection, loadConfig]);

  const value = useMemo(
    () => ({ household, connection, config, error, dispatch, connect, disconnect, refresh, setupVoice, post }),
    [household, connection, config, error, dispatch, connect, disconnect, refresh, setupVoice, post],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHousehold must be used inside HouseholdProvider");
  return v;
}
