import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackup } from "../src/apply/backup.js";
import { BlockError, END, mergeItems, readItems, START, stripManagedBlock, writeItems } from "../src/apply/block.js";
import { unifiedDiff } from "../src/apply/diff.js";
import { isBalanced } from "../src/analyze/normalize.js";
import { suggest } from "../src/analyze/suggest.js";
import { type Io, run } from "../src/cli.js";

const lines = (command: string, times: number): string[] => Array.from({ length: times }, () => command);

interface Sandbox {
  home: string;
  history: string;
  out: string[];
  err: string[];
  io: Io;
  rc: (name: string) => string;
}

/** A temp HOME with a history file. The real HOME is never used. */
function sandbox(historyLines: string[], env: NodeJS.ProcessEnv = {}): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "af-apply-"));
  const history = join(home, "history.txt");
  writeFileSync(history, historyLines.join("\n") + "\n");
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), home, env: { PATH: "", ...env } };
  return { home, history, out, err, io, rc: (name) => readFileSync(join(home, name), "utf8") };
}

const HISTORY = [...lines("git status", 8), ...lines("git checkout main", 3), ...lines("git checkout dev", 3)];
const backups = (home: string): string[] => readdirSync(home).filter((f) => f.includes("aliasforge-backup"));

const apply = (s: Sandbox, ...extra: string[]): number =>
  run(["apply", "--shell", "zsh", "--file", s.history, ...extra], s.io);

describe("block", () => {
  const items = [{ name: "gs", lines: ["alias gs='git status'"] }];

  it("appends a block, keeping the rest of the file intact", () => {
    const next = writeItems("export A=1\n", items);
    expect(next).toBe(`export A=1\n\n${START}\n# Managed by aliasforge. \`aliasforge apply\` edits only this block.\nalias gs='git status'\n${END}\n`);
    expect(next.startsWith("export A=1\n")).toBe(true);
  });

  it("replaces an existing block in place", () => {
    const first = writeItems("top\n", items);
    const second = writeItems(`${first}bottom\n`, [{ name: "gc", lines: ["alias gc='git commit'"] }]);
    expect(second).toContain("alias gc=");
    expect(second).not.toContain("alias gs=");
    expect(second.startsWith("top\n")).toBe(true);
    expect(second.endsWith("bottom\n")).toBe(true);
  });

  it("works on an empty file and keeps CRLF endings", () => {
    expect(writeItems("", items).startsWith(START)).toBe(true);
    const crlf = writeItems("a\r\nb\r\n", items);
    expect(crlf).toContain("b\r\n\r\n" + START + "\r\n");
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("is idempotent", () => {
    const once = writeItems("x\n", items);
    expect(writeItems(once, readItems(once, "bash"))).toBe(once);
  });

  it("rejects damaged blocks", () => {
    for (const text of [`${START}\nalias a=b\n`, `${END}\n${START}\n`, `${START}\n${START}\n${END}\n`, `a\n${END}\n`]) {
      expect(() => readItems(text, "bash")).toThrow(BlockError);
      expect(() => writeItems(text, items)).toThrow(BlockError);
    }
  });

  it("reads fish functions as one item and merges without duplicates", () => {
    const text = writeItems("", [
      { name: "gs", lines: ["alias gs 'git status'"] },
      { name: "dx", lines: ["function dx", "    docker exec -it $argv[1] bash", "end"] },
    ]);
    const existing = readItems(text, "fish");
    expect(existing.map((i) => [i.name, i.lines.length])).toEqual([["gs", 1], ["dx", 3]]);
    const merged = mergeItems(existing, [existing[0]!, { name: "ga", lines: ["alias ga 'git add'"] }]);
    expect(merged.changes).toEqual([{ name: "gs", status: "unchanged" }, { name: "ga", status: "added" }]);
    expect(merged.items).toHaveLength(3);
  });

  it("strips the block for collision scanning", () => {
    const text = writeItems("alias mine=x\n", items);
    expect(stripManagedBlock(text)).not.toContain("alias gs");
    expect(stripManagedBlock(text)).toContain("alias mine");
    expect(stripManagedBlock(`${START}\nbroken`)).toContain("broken");
  });
});

describe("diff and backup", () => {
  it("shows a unified diff for an appended block", () => {
    const diff = unifiedDiff("/h/.zshrc", "a\nb\n", "a\nb\n\nNEW\n");
    expect(diff).toBe("--- /h/.zshrc\n+++ /h/.zshrc\n@@ -1,2 +1,4 @@\n a\n b\n+\n+NEW");
    expect(unifiedDiff("p", "same\n", "same\n")).toBe("");
    expect(unifiedDiff("p", "", "x\n")).toContain("--- /dev/null");
  });

  it("never overwrites an existing backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "af-backup-"));
    const file = join(dir, ".bashrc");
    writeFileSync(file, "one");
    const when = new Date("2026-10-18T12:34:56.789Z");
    const first = createBackup(file, when);
    writeFileSync(file, "two");
    const second = createBackup(file, when);
    expect(first).toBe(`${file}.aliasforge-backup-20261018-123456`);
    expect(second).not.toBe(first);
    expect(readFileSync(first, "utf8")).toBe("one");
    expect(readFileSync(second, "utf8")).toBe("two");
  });
});

describe("apply command", () => {
  it("writes a block after backing up, and leaves the rest alone", () => {
    const s = sandbox(HISTORY);
    const original = "# my zshrc\nexport EDITOR=vim\n";
    writeFileSync(join(s.home, ".zshrc"), original);
    expect(apply(s)).toBe(0);

    const rc = s.rc(".zshrc");
    expect(rc.startsWith(original)).toBe(true);
    expect(rc).toContain(START);
    expect(rc).toMatch(/alias gs?t?='git status'/);
    expect(rc).toContain("alias gco='git checkout'");
    const [backup] = backups(s.home);
    expect(backups(s.home)).toHaveLength(1);
    expect(readFileSync(join(s.home, backup as string), "utf8")).toBe(original);
    expect(s.out.join("\n")).toContain("Backup:");
  });

  it("running twice changes nothing", () => {
    const s = sandbox(HISTORY);
    writeFileSync(join(s.home, ".zshrc"), "export A=1\n");
    apply(s);
    const afterFirst = s.rc(".zshrc");
    s.out.length = 0;
    expect(apply(s)).toBe(0);
    expect(s.rc(".zshrc")).toBe(afterFirst);
    expect(backups(s.home)).toHaveLength(1);
    expect(s.out.join("\n")).toContain("Nothing to change.");
  });

  it("--dry-run prints a diff and writes nothing", () => {
    const s = sandbox(HISTORY);
    writeFileSync(join(s.home, ".zshrc"), "export A=1\n");
    expect(apply(s, "--dry-run")).toBe(0);
    expect(s.rc(".zshrc")).toBe("export A=1\n");
    expect(backups(s.home)).toEqual([]);
    const text = s.out.join("\n");
    expect(text).toContain("+" + START);
    expect(text).toContain("Dry run: nothing was written.");
  });

  it("creates a missing rc file without a backup", () => {
    const s = sandbox(HISTORY);
    expect(run(["apply", "--shell", "bash", "--file", s.history], s.io)).toBe(0);
    expect(s.rc(".bashrc").startsWith(START)).toBe(true);
    expect(backups(s.home)).toEqual([]);
    expect(s.out.join("\n")).toContain("No backup needed");
  });

  it("writes fish functions to config.fish, creating the folder", () => {
    const commands = [...HISTORY, ...lines("docker exec -it web bash", 3), ...lines("docker exec -it db bash", 3)];
    const s = sandbox(commands.map((command) => `- cmd: ${command}\n  when: 1700000000`));
    expect(run(["apply", "--shell", "fish", "--file", s.history], s.io)).toBe(0);
    const rc = readFileSync(join(s.home, ".config/fish/config.fish"), "utf8");
    expect(rc).toContain("alias gco 'git checkout'");
    expect(rc).toMatch(/function \w+\n {4}docker exec -it \$argv\[1\] bash\nend/);
  });

  it("honours ZDOTDIR for zsh", () => {
    const zdot = mkdtempSync(join(tmpdir(), "af-zdot-"));
    const s = sandbox(HISTORY, { ZDOTDIR: zdot });
    apply(s);
    expect(readFileSync(join(zdot, ".zshrc"), "utf8")).toContain(START);
    expect(existsSync(join(s.home, ".zshrc"))).toBe(false);
  });

  it("--select picks by rank or name and rejects unknown ones", () => {
    const s = sandbox(HISTORY);
    expect(apply(s, "--select", "gco")).toBe(0);
    const rc = s.rc(".zshrc");
    expect(rc).toContain("alias gco=");
    expect(rc).not.toContain("git status");

    const t = sandbox(HISTORY);
    expect(apply(t, "--select", "1")).toBe(0);
    expect(t.rc(".zshrc").match(/^alias /gm)).toHaveLength(1);

    for (const bad of ["99", "nope"]) {
      const u = sandbox(HISTORY);
      expect(apply(u, "--select", bad)).toBe(2);
      expect(existsSync(join(u.home, ".zshrc"))).toBe(false);
    }
  });

  it("requires --shell", () => {
    const s = sandbox(HISTORY);
    expect(run(["apply", "--file", s.history], s.io)).toBe(2);
    expect(s.err.join("\n")).toContain("--shell");
  });

  it("keeps earlier definitions when history no longer suggests them", () => {
    const s = sandbox(HISTORY);
    apply(s);
    const first = s.rc(".zshrc");
    writeFileSync(s.history, [...lines("docker compose up -d", 6)].join("\n") + "\n");
    expect(apply(s)).toBe(0);
    const second = s.rc(".zshrc");
    for (const line of first.split("\n").filter((l) => l.startsWith("alias "))) expect(second).toContain(line);
    expect(second).toContain("docker compose up -d");
    expect(second.match(new RegExp(START, "g"))).toHaveLength(1);
  });

  it("does not reuse a name already taken by a different definition in the block", () => {
    const s = sandbox(HISTORY);
    writeFileSync(join(s.home, ".zshrc"), `${START}\nalias gst='echo mine'\n${END}\n`);
    apply(s);
    const rc = s.rc(".zshrc");
    expect(rc).toContain("alias gst='echo mine'");
    expect(rc.match(/^alias gst=/gm)).toHaveLength(1);
    expect(rc).toContain("='git status'");
  });

  it("refuses to touch a damaged block", () => {
    const s = sandbox(HISTORY);
    const damaged = `keep\n${START}\nalias x=y\n`;
    writeFileSync(join(s.home, ".zshrc"), damaged);
    expect(apply(s)).toBe(1);
    expect(s.rc(".zshrc")).toBe(damaged);
    expect(backups(s.home)).toEqual([]);
    expect(s.err.join("\n")).toContain("damaged");
  });

  it("does nothing when there are no suggestions", () => {
    const s = sandbox(["ls", "pwd"]);
    expect(apply(s)).toBe(0);
    expect(existsSync(join(s.home, ".zshrc"))).toBe(false);
    expect(s.out.join("\n")).toContain("No alias suggestions");
  });
});

describe("rc safety", () => {
  it("isBalanced spots text that would break a function body", () => {
    for (const ok of ["echo 'a b'", 'echo "a (b"', "echo $(date)", "echo \\(", "echo {a,b}"]) expect(isBalanced(ok), ok).toBe(true);
    for (const bad of ['echo "open', "echo 'open", "echo (", "echo )", "echo }", "echo `x", "echo \\"]) expect(isBalanced(bad), bad).toBe(false);
  });

  it("never offers a function whose body could break out", () => {
    const none = (): boolean => false;
    const options = { shell: "bash", minCount: 2, minLength: 8, top: 10 } as const;
    for (const [a, b] of <[string, string][]>[
      ['docker exec -it web echo "oops', 'docker exec -it db echo "oops'],
      ["docker exec -it web bash # note", "docker exec -it db bash # note"],
      ["docker exec -it web sleep 9 &", "docker exec -it db sleep 9 &"],
      ["docker exec -it web cat <<EOF", "docker exec -it db cat <<EOF"],
    ]) {
      const entries = [a, b, a, b].map((command) => ({ command }));
      expect(suggest(entries, none, options).filter((s) => s.kind === "function"), a).toEqual([]);
    }
  });

  it("quotes alias bodies so history text cannot escape", () => {
    const s = sandbox(lines("echo 'hi'; rm -rf ~ #", 6));
    apply(s);
    const alias = s.rc(".zshrc").split("\n").find((l) => l.startsWith("alias "));
    expect(alias).toMatch(/^alias \w+='echo '\\''hi'\\''; rm -rf ~ #'$/);
  });
});
