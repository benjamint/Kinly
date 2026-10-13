/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import type { IncomingMessage } from "node:http";

/** Serves the same /api handlers Vercel runs, so `npm run dev` is the whole app. */
function devApi(): Plugin {
  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : undefined);
        } catch {
          resolve(undefined);
        }
      });
    });

  return {
    name: "kinly-dev-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        const h = (await server.ssrLoadModule("/server/handlers.ts")) as typeof import("./server/handlers");
        const env = h.envFromProcess();
        const apiReq = {
          method: req.method ?? "GET",
          query: Object.fromEntries(url.searchParams),
          headers: req.headers as Record<string, string | undefined>,
          body: req.method === "POST" ? await readBody(req) : undefined,
        };
        const path = url.pathname.replace(/^\/api\//, "");
        try {
          const out =
            path === "config"
              ? await h.handleConfig(env)
              : path === "household"
                ? await h.handleHousehold(env, apiReq)
                : path === "session"
                  ? await h.handleSession(env, apiReq)
                  : path === "setup-voice"
                    ? await h.handleSetupVoice(env, apiReq)
                  : path.startsWith("tools/")
                    ? await h.handleTool(env, path.slice("tools/".length), apiReq)
                    : { status: 404, body: { error: "Not found." } };
          res.statusCode = out.status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(out.body));
        } catch (err) {
          console.error(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "Something went wrong." }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make server-only secrets from .env available to the dev API.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    plugins: [
      react(),
      devApi(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        manifest: {
          name: "Kinly",
          short_name: "Kinly",
          description: "A warm voice companion for older adults.",
          start_url: "/",
          display: "fullscreen",
          orientation: "any",
          background_color: "#FFF4E8",
          theme_color: "#E8875B",
          icons: [
            { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: { navigateFallbackDenylist: [/^\/api\//] },
      }),
    ],
    server: { host: true },
    test: { environment: "node" },
  };
});
