import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultHistoryPath, detectShell, loadHistory, parseBash, parseFish, parseZsh } from "../src/history/index.js";

const fixture = (name: string): Uint8Array => readFileSync(join(import.meta.dirname, "fixtures", name));
const commands = (entries: { command: string }[]): string[] => entries.map((e) => e.command);

describe("bash parser", () => {
  it("reads timestamps and skips blank lines", () => {
    const entries = parseBash(fixture("bash_history"));
    expect(entries[0]).toEqual({ command: "git status", timestamp: 1700000000 });
    expect(entries[1]).toEqual({ command: "ls -la", timestamp: 1700000060 });
    expect(commands(entries)).toEqual(["git status", "ls -la", 'echo "unterminated', "npm test", "#notatimestamp"]);
    expect(entries[2]?.timestamp).toBeUndefined();
  });

  it("handles CRLF", () => {
    const entries = parseBash(fixture("bash_history_crlf"));
    expect(commands(entries)).toEqual(["git status", "ls -la"]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseBash(fixture("empty_history"))).toEqual([]);
  });

  it("ignores a leading BOM", () => {
    expect(commands(parseBash("﻿ls\n"))).toEqual(["ls"]);
  });
});

describe("zsh parser", () => {
  it("parses extended and plain lines, joining continuations", () => {
    const entries = parseZsh(fixture("zsh_history"));
    expect(entries).toEqual([
      { command: "git status", timestamp: 1700000000 },
      { command: "echo one \n  two\n  three", timestamp: 1700000100 },
      { command: "ls -la", timestamp: 1700000200 },
      { command: "plain line without timestamp" },
      { command: ": garbage no semicolon" },
    ]);
  });

  it("unmetafies bytes", () => {
    const entries = parseZsh(fixture("zsh_history_metafied"));
    expect(commands(entries)).toEqual(["echo straße", "echo café"]);
  });

  it("keeps a trailing continuation at end of file", () => {
    expect(commands(parseZsh("echo hi \\\n"))).toEqual(["echo hi "]);
  });

  it("survives a dangling meta byte", () => {
    expect(commands(parseZsh(new Uint8Array([0x6c, 0x73, 0x83])))).toEqual(["ls"]);
  });

  it("handles CRLF and empty input", () => {
    expect(commands(parseZsh(": 1:0;ls\r\n: 2:0;pwd\r\n"))).toEqual(["ls", "pwd"]);
    expect(parseZsh(fixture("empty_history"))).toEqual([]);
  });
});

describe("fish parser", () => {
  it("parses cmd and when, unescaping values", () => {
    const entries = parseFish(fixture("fish_history"));
    expect(entries).toEqual([
      { command: "git status", timestamp: 1700000000 },
      { command: 'echo "a\\nb"', timestamp: 1700000050 },
      { command: "ls\nls -la", timestamp: 1700000100 },
      { command: "no timestamp" },
    ]);
  });

  it("handles CRLF and empty input", () => {
    expect(commands(parseFish("- cmd: ls\r\n  when: 5\r\n"))).toEqual(["ls"]);
    expect(parseFish(fixture("empty_history"))).toEqual([]);
  });
});

describe("huge files", () => {
  it("parses 300k lines for every shell", () => {
    const n = 300_000;
    const bash = Array.from({ length: n }, (_, i) => `cmd ${i}`).join("\n");
    const zsh = Array.from({ length: n }, (_, i) => `: ${1700000000 + i}:0;cmd ${i}`).join("\n");
    const fish = Array.from({ length: n }, (_, i) => `- cmd: cmd ${i}\n  when: ${1700000000 + i}`).join("\n");
    expect(parseBash(bash)).toHaveLength(n);
    expect(parseZsh(zsh)).toHaveLength(n);
    expect(parseFish(fish)).toHaveLength(n);
  });
});

describe("detect and load", () => {
  it("detects by file name, then content", () => {
    expect(detectShell("/x/.zsh_history", "")).toBe("zsh");
    expect(detectShell("/x/fish_history", "")).toBe("fish");
    expect(detectShell("/x/hist.txt", "- cmd: ls\n  when: 1\n")).toBe("fish");
    expect(detectShell("/x/hist.txt", ": 1:0;ls\n")).toBe("zsh");
    expect(detectShell("/x/hist.txt", "ls\n")).toBe("bash");
  });

  it("builds default paths", () => {
    expect(defaultHistoryPath("fish", "/h")).toBe("/h/.local/share/fish/fish_history");
  });

  it("loads a file with detection", () => {
    const file = join(import.meta.dirname, "fixtures", "zsh_history");
    const loaded = loadHistory({ file, home: "/nonexistent" });
    expect(loaded.shell).toBe("zsh");
    expect(loaded.entries).toHaveLength(5);
  });
});
