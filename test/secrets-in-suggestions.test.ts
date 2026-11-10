import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { suggest } from "../src/analyze/suggest.js";
import { type Io, run } from "../src/cli.js";

// Obviously fake values that only match the shape of real secrets.
const TOKEN = "ghp_FAKE0123456789abcdefghijklmnopqrstuv";
const BEARER = "abcdef1234567890zzzz";
const none = (): boolean => false;
const repeat = (command: string, times = 6) => Array.from({ length: times }, () => ({ command }));
const opts = { shell: "bash" as const, minCount: 2, minLength: 8, top: 20 };

describe("secrets never reach suggestions", () => {
  it("drops commands that contain a token, a bearer header or a URL password", () => {
    const entries = [
      ...repeat(`export GITHUB_TOKEN=${TOKEN}`),
      ...repeat(`curl -H 'Authorization: Bearer ${BEARER}' https://api.example.com/v1/items`),
      ...repeat("git status"),
    ];
    const all = JSON.stringify(suggest(entries, none, opts));
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(BEARER);
    expect(all).toContain("git status");
  });

  it("keeps a clean sub-command of a line that has a secret", () => {
    const entries = repeat(`export GITHUB_TOKEN=${TOKEN} && make deploy`);
    const result = suggest(entries, none, opts);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result.map((s) => s.command)).toContain("make deploy");
  });

  it("does not build a template around a varying secret argument", () => {
    const entries = [1, 2, 3, 4, 5, 6].flatMap((n) => repeat(`mysql --password=hunter${n}secret -h db`, 1));
    const all = JSON.stringify(suggest(entries, none, opts));
    expect(all).not.toMatch(/hunter\dsecret/);
  });
});

describe("cli", () => {
  function sandbox(lines: string[]) {
    const home = mkdtempSync(join(tmpdir(), "af-secret-"));
    const history = join(home, "history.txt");
    writeFileSync(history, lines.join("\n") + "\n");
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), home, env: { PATH: "" } };
    return { home, history, out, err, io };
  }
  const history = [
    ...repeat(`export GITHUB_TOKEN=${TOKEN} && make deploy`).map((e) => e.command),
    ...repeat("git status").map((e) => e.command),
  ];

  it("suggest prints no secret, and says why entries were left out (on stderr)", () => {
    const box = sandbox(history);
    run(["suggest", "--shell", "bash", "--file", box.history, "--min-count", "2"], box.io);
    expect(box.out.join("\n")).not.toContain(TOKEN);
    expect(box.err.join("\n")).toMatch(/6 history entries contain a secret/);
  });

  it("suggest --json stays valid and secret-free", () => {
    const box = sandbox(history);
    run(["suggest", "--shell", "bash", "--file", box.history, "--min-count", "2", "--json"], box.io);
    const text = box.out.join("\n");
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain(TOKEN);
  });

  it("apply writes no secret into the rc file", () => {
    const box = sandbox(history);
    run(["apply", "--shell", "bash", "--file", box.history, "--min-count", "2"], box.io);
    const rc = join(box.home, ".bashrc");
    const text = existsSync(rc) ? readFileSync(rc, "utf8") : "";
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("make deploy");
  });
});
