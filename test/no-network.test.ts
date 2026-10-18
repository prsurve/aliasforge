import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNED = [
  /\bfetch\s*\(/,
  /from\s+["'](?:node:)?(?:https?|http2|net|tls|dgram|dns)["']/,
  /require\(\s*["'](?:node:)?(?:https?|http2|net|tls|dgram|dns)["']\s*\)/,
  /import\(\s*["'](?:node:)?(?:https?|http2|net|tls|dgram|dns)["']\s*\)/,
  /\bXMLHttpRequest\b|\bWebSocket\b/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("no network access", () => {
  it("src/ never imports or calls network APIs", () => {
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      for (const pattern of BANNED) {
        expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
