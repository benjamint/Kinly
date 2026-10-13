import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vercel runs api/ as plain Node ES modules, where relative imports must end
// in ".js". Vite and vitest don't care, so check it here.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("server-side imports", () => {
  it("use explicit .js extensions", () => {
    const bad = ["api", "server", "src/shared", "agent"].flatMap(files).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)]
        .map((m) => m[1])
        .filter((spec) => !spec.endsWith(".js"))
        .map((spec) => `${f}: ${spec}`),
    );
    expect(bad).toEqual([]);
  });
});
