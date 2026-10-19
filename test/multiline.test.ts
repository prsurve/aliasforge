import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandLines } from "../src/analyze/normalize.js";
import { suggest } from "../src/analyze/suggest.js";
import { computeStats } from "../src/analyze/stats.js";
import { parseZsh } from "../src/history/index.js";
import { scanHistory } from "../src/risks/engine.js";

const none = (): boolean => false;
const fixture = readFileSync(join(import.meta.dirname, "fixtures", "zsh_history_multiline"));

describe("commandLines", () => {
  it("joins backslash continuations with one space", () => {
    expect(commandLines("python3 t.py \\\n  --a 1 \\\n  --b 2")).toEqual(["python3 t.py --a 1 --b 2"]);
    expect(commandLines("ls \\\r\n -la")).toEqual(["ls -la"]);
  });

  it("splits pasted commands on bare newlines", () => {
    expect(commandLines("cd /x\ndocker compose up\n\n  ls  \n")).toEqual(["cd /x", "docker compose up", "ls"]);
    expect(commandLines("a\r\nb")).toEqual(["a", "b"]);
  });

  it("keeps a quoted newline inside its command", () => {
    expect(commandLines('psql -c "select 1\nfrom t"\nls')).toEqual(['psql -c "select 1 from t"', "ls"]);
    expect(commandLines("echo 'a\nb'")).toEqual(["echo 'a b'"]);
  });

  it("treats a backslash in single quotes as literal", () => {
    expect(commandLines("echo 'a\\\nb'")).toEqual(["echo 'a\\ b'"]);
  });

  it("does not let an apostrophe in a comment swallow later lines", () => {
    expect(commandLines("# don't do this\nls\npwd")).toEqual(["# don't do this", "ls", "pwd"]);
    expect(commandLines("ls # it's fine\npwd")).toEqual(["ls # it's fine", "pwd"]);
  });

  it("does not mistake # inside a word for a comment", () => {
    expect(commandLines("echo $#\necho a#b 'x\ny'")).toEqual(["echo $#", "echo a#b 'x y'"]);
  });

  it("keeps escaped quotes and handles odd input", () => {
    expect(commandLines('echo "a \\" b"\nls')).toEqual(['echo "a \\" b"', "ls"]);
    expect(commandLines("")).toEqual([]);
    expect(commandLines("\n\n  \n")).toEqual([]);
    expect(commandLines("echo hi \\")).toEqual(["echo hi"]);
    expect(commandLines('echo "never closed\nls')).toEqual(['echo "never closed ls']);
  });
});

describe("real zsh multi-line entries", () => {
  const entries = parseZsh(fixture);

  it("parses into three entries", () => {
    expect(entries).toHaveLength(3);
    expect(commandLines(entries[0]?.command as string)).toEqual(["python3 tool.py --seconds 10 --style random"]);
    expect(commandLines(entries[1]?.command as string)).toEqual([
      "cd /some/dir",
      "docker compose up -d",
      "curl -fsSL https://example.com/i.sh | bash",
    ]);
  });

  it("suggest writes an alias with no stray backslashes", () => {
    const history = Array.from({ length: 6 }, () => entries[0] as { command: string });
    const [first] = suggest(history, none, { shell: "zsh", minCount: 5, minLength: 8, top: 5 });
    expect(first?.command).toBe("python3 tool.py --seconds 10 --style random");
    expect(first?.definition).not.toMatch(/\\/);
  });

  it("suggest never combines pasted commands", () => {
    const history = Array.from({ length: 6 }, () => entries[1] as { command: string });
    const patterns = suggest(history, none, { shell: "zsh", minCount: 5, minLength: 8, top: 10 }).map((s) => s.pattern);
    expect(patterns).toContain("docker compose up -d");
    expect(patterns.some((p) => p.includes("cd /some/dir docker"))).toBe(false);
  });

  it("stats counts each pasted command separately", () => {
    const stats = computeStats(entries, 10);
    const programs = Object.fromEntries(stats.topCommands.map((c) => [c.command, c.count]));
    expect(programs).toMatchObject({ python3: 1, cd: 1, docker: 1, curl: 1, bash: 1, echo: 1, ls: 1 });
    expect(stats.historyEntries).toBe(3);
    expect(stats.uniqueCommands).toBe(6);
  });

  it("risks reports the right command with the right entry number", () => {
    const findings = scanHistory(entries);
    expect(findings.map((f) => [f.id, f.entry, f.preview])).toEqual([
      ["core/pipe-to-shell", 2, "curl -fsSL https://example.com/i.sh | bash"],
    ]);
  });
});
