import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Io, run } from "../src/cli.js";
import type { Shell } from "../src/history/types.js";

/**
 * End-to-end run per shell: a history file in that shell's own format at its
 * default path, then every command through the CLI. The "real shell" tests
 * also load the generated rc file in the actual shell. CI installs all three
 * shells and sets AF_E2E_REQUIRE_SHELL=1 so a missing shell fails instead of
 * being skipped. AF_E2E_SHELL limits the run to one shell.
 */
const ONLY = process.env.AF_E2E_SHELL;
const REQUIRED = process.env.AF_E2E_REQUIRE_SHELL === "1";
const SHELLS: Shell[] = ["bash", "zsh", "fish"];

// Assembled at runtime so no token-shaped literal sits in the repo.
const FAKE_TOKEN = "ghp_" + "x".repeat(36);

const repeat = (command: string, times: number): string[] => Array.from({ length: times }, () => command);

const COMMANDS = [
  ...repeat("git status", 8),
  ...repeat("git checkout main", 3),
  ...repeat("git checkout dev", 3),
  ...repeat("docker exec -it web bash", 3),
  ...repeat("docker exec -it db bash", 3),
  ...repeat("kubectl get pods -n prod", 6),
  "ls",
  `export GITHUB_TOKEN=${FAKE_TOKEN}`,
  "git push --force origin main",
  "rm -rf $BUILD_DIR/out",
];

const START_TIME = 1_700_000_000;

function historyText(shell: Shell): string {
  const stamp = (i: number): number => START_TIME + i * 60;
  switch (shell) {
    case "bash":
      return COMMANDS.map((c, i) => `#${stamp(i)}\n${c}`).join("\n") + "\n";
    case "zsh":
      return COMMANDS.map((c, i) => `: ${stamp(i)}:0;${c}`).join("\n") + "\n";
    case "fish":
      return COMMANDS.map((c, i) => `- cmd: ${c}\n  when: ${stamp(i)}`).join("\n") + "\n";
  }
}

const HISTORY_PATH: Record<Shell, string> = {
  bash: ".bash_history",
  zsh: ".zsh_history",
  fish: ".local/share/fish/fish_history",
};

const RC_PATH: Record<Shell, string> = {
  bash: ".bashrc",
  zsh: ".zshrc",
  fish: ".config/fish/config.fish",
};

interface Sandbox {
  home: string;
  io: Io;
  out: string[];
  err: string[];
}

/** A temp HOME holding this shell's history at its default location. */
function sandbox(shell: Shell): Sandbox {
  const home = mkdtempSync(join(tmpdir(), `af-e2e-${shell}-`));
  const history = join(home, HISTORY_PATH[shell]);
  mkdirSync(dirname(history), { recursive: true });
  writeFileSync(history, historyText(shell));
  const out: string[] = [];
  const err: string[] = [];
  return { home, out, err, io: { out: (t) => out.push(t), err: (t) => err.push(t), home, env: { PATH: "" } } };
}

function hasShell(shell: Shell): boolean {
  return spawnSync(shell, ["--version"], { stdio: "ignore" }).status === 0;
}

interface SuggestJson {
  suggestions: { kind: string; pattern: string; names: string[]; definition: string }[];
}

/** Script run inside the shell: load the rc file, stub git/docker, call an alias and a function. */
const SCRIPTS: Record<Shell, string> = {
  bash: 'shopt -s expand_aliases\nsource "$1"\ngit() { echo "git $*"; }\ndocker() { echo "docker $*"; }\neval "$2 main"\neval "$3 web"\n',
  zsh: 'source "$1"\ngit() { echo "git $*"; }\ndocker() { echo "docker $*"; }\neval "$2 main"\neval "$3 web"\n',
  fish: 'source $argv[1]\nfunction git; echo "git $argv"; end\nfunction docker; echo "docker $argv"; end\neval "$argv[2] main"\neval "$argv[3] web"\n',
};

function shellCommand(shell: Shell, script: string, args: string[]): { command: string; args: string[] } {
  if (shell === "bash") return { command: "bash", args: ["--norc", "--noprofile", "-c", script, "_", ...args] };
  if (shell === "zsh") return { command: "zsh", args: ["-f", "-c", script, "_", ...args] };
  return { command: "fish", args: ["--no-config", "-c", script, ...args] };
}

function syntaxCommand(shell: Shell, file: string): { command: string; args: string[] } {
  if (shell === "fish") return { command: "fish", args: ["--no-execute", file] };
  return { command: shell, args: ["-n", file] };
}

function exec(spec: { command: string; args: string[] }, home: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(spec.command, spec.args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: home },
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

for (const shell of SHELLS) {
  describe.runIf(ONLY === undefined || ONLY === shell)(`e2e ${shell}`, () => {
    it("suggest reads the default history file and writes the right dialect", () => {
      const s = sandbox(shell);
      expect(run(["suggest", "--shell", shell, "--json"], s.io)).toBe(0);
      const report = JSON.parse(s.out[0] as string) as SuggestJson & { shell: string; historyEntries: number };
      expect(report.shell).toBe(shell);
      expect(report.historyEntries).toBe(COMMANDS.length);
      const patterns = report.suggestions.map((x) => x.pattern);
      expect(patterns).toEqual(
        expect.arrayContaining(["git status", "git checkout <arg>", "docker exec -it <arg> bash", "kubectl get pods -n prod"]),
      );
      const fn = report.suggestions.find((x) => x.kind === "function");
      expect(fn?.definition).toContain(shell === "fish" ? "$argv[1]" : '"$1"');
      expect(report.suggestions.find((x) => x.kind === "alias")?.definition).toContain(
        shell === "fish" ? "alias " + report.suggestions.find((x) => x.kind === "alias")?.names[0] + " '" : "='",
      );
    });

    it("risks finds the planted problems and never prints the token", () => {
      const s = sandbox(shell);
      expect(run(["risks", "--shell", shell, "--json"], s.io)).toBe(0);
      const report = JSON.parse(s.out[0] as string) as { findings: { id: string; date?: string; preview: string }[] };
      const ids = report.findings.map((f) => f.id);
      expect(ids).toEqual(expect.arrayContaining(["git/github-token", "git/force-push-main", "core/rm-rf-unquoted-variable"]));
      expect(s.out[0]).not.toContain(FAKE_TOKEN);
      expect(report.findings.find((f) => f.id === "git/github-token")?.preview).toBe("export GITHUB_TOKEN=ghp_****");
      expect(report.findings.every((f) => f.date !== undefined)).toBe(true);
    });

    it("stats counts entries, top programs and the time span", () => {
      const s = sandbox(shell);
      expect(run(["stats", "--shell", shell, "--json"], s.io)).toBe(0);
      const stats = JSON.parse(s.out[0] as string);
      expect(stats).toMatchObject({
        shell,
        historyEntries: COMMANDS.length,
        timestampedEntries: COMMANDS.length,
        firstDate: "2023-11-14",
        uniqueCommands: 10,
        lastDate: "2023-11-14",
        spanDays: 0,
        topCommands: [
          { command: "git", count: 15 },
          { command: "docker", count: 6 },
          { command: "kubectl", count: 6 },
          { command: "export", count: 1 },
          { command: "ls", count: 1 },
          { command: "rm", count: 1 },
        ],
      });
    });

    it("apply writes the rc file once and is idempotent", () => {
      const s = sandbox(shell);
      const rc = join(s.home, RC_PATH[shell]);
      expect(run(["apply", "--shell", shell], s.io)).toBe(0);
      expect(existsSync(rc)).toBe(true);
      const first = readFileSync(rc, "utf8");
      expect(first).toContain("# >>> aliasforge >>>");
      expect(run(["apply", "--shell", shell], s.io)).toBe(0);
      expect(readFileSync(rc, "utf8")).toBe(first);
      expect(s.out.at(-1)).toContain("Nothing to change.");
    });

    describe(`real ${shell}`, () => {
      const available = hasShell(shell);

      it.runIf(REQUIRED)("is installed (required in CI)", () => {
        expect(available).toBe(true);
      });

      it.skipIf(!available)("accepts the generated rc file and runs its definitions", () => {
        const s = sandbox(shell);
        run(["suggest", "--shell", shell, "--json"], s.io);
        const report = JSON.parse(s.out[0] as string) as SuggestJson;
        const alias = report.suggestions.find((x) => x.pattern === "git checkout <arg>")?.names[0] as string;
        const fn = report.suggestions.find((x) => x.kind === "function")?.names[0] as string;

        s.out.length = 0;
        expect(run(["apply", "--shell", shell, "--top", "10"], s.io)).toBe(0);
        const rc = join(s.home, RC_PATH[shell]);

        const syntax = exec(syntaxCommand(shell, rc), s.home);
        expect(syntax.stderr).toBe("");
        expect(syntax.status).toBe(0);

        const result = exec(shellCommand(shell, SCRIPTS[shell], [rc, alias, fn]), s.home);
        expect(result.stderr).toBe("");
        expect(result.stdout.trim().split("\n")).toEqual(["git checkout main", "docker exec -it web bash"]);
      });
    });
  });
}
