import type { VercelRequest, VercelResponse } from "@vercel/node";
import { envFromProcess, type ApiRequest, type ApiResponse, type ServerEnv } from "./handlers";

type Handler = (env: ServerEnv, req: ApiRequest) => Promise<ApiResponse>;

export function toApiRequest(req: VercelRequest): ApiRequest {
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) query[k] = Array.isArray(v) ? v[0] : v;
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
  return { method: req.method ?? "GET", query, headers, body: req.body };
}

/** Wraps a framework-agnostic handler as a Vercel function. */
export function vercel(handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    try {
      const out = await handler(envFromProcess(), toApiRequest(req));
      res.setHeader("Cache-Control", "no-store");
      res.status(out.status).json(out.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Something went wrong." });
    }
  };
}
