#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { applyToRc, rcPathFor, type ApplyResult } from "./apply/apply.js";
import { selectSuggestions } from "./apply/select.js";
import { UsageError } from "./errors.js";
import { createEnvironment } from "./analyze/environment.js";
import { renderJson, renderReport } from "./analyze/report.js";
import { computeStats, renderStats } from "./analyze/stats.js";
import { suggest } from "./analyze/suggest.js";
import { loadHistory, type LoadedHistory, type Shell } from "./history/index.js";
import { scanHistory } from "./risks/engine.js";
import { renderRisks, renderRisksJson } from "./risks/report.js";

const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
const SHELLS: Shell[] = ["bash", "zsh", "fish"];

const HELP = `aliasforge ${VERSION}

Usage: aliasforge <command> [options]

Commands:
  suggest   Suggest aliases from shell history
  risks     Flag dangerous commands and leaked secrets
  apply     Write chosen aliases to a managed block in your rc file
  stats     Show history size, top commands and time span

suggest options:
  --shell bash|zsh|fish   Shell dialect (default: from --file or $SHELL)
  --file <path>           Read this history file instead of the default
  --min-count N           Minimum occurrences (default 5)
  --min-length N          Minimum command length in characters (default 8)
  --top N                 Number of suggestions (default 10)
  --json                  Machine-readable output

risks options:
  --shell, --file, --json as above

stats options:
  --shell, --file, --json as above, plus --top N (default 10)

apply options:
  --shell bash|zsh|fish   Required. Which rc file to update
  --select 1,3,gs         Ranks or names from suggest (default: all suggestions)
  --dry-run               Print a diff and write nothing
  --file, --min-count, --min-length, --top as for suggest

apply writes only between "# >>> aliasforge >>>" and "# <<< aliasforge <<<",
keeps definitions already in the block, and makes a timestamped backup first.
`;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  home: string;
  env: NodeJS.ProcessEnv;
}

function defaultIo(): Io {
  return {
    out: (text) => console.log(text),
    err: (text) => console.error(text),
    home: homedir(),
    env: process.env,
  };
}


function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`${name} must be a positive integer`);
  return parsed;
}

function parseShell(value: string | undefined): Shell | undefined {
  if (value === undefined) return undefined;
  if (!SHELLS.includes(value as Shell)) throw new UsageError("--shell must be bash, zsh or fish");
  return value as Shell;
}

function shellFromEnv(env: NodeJS.ProcessEnv): Shell {
  const name = basename(env.SHELL ?? "");
  return SHELLS.find((shell) => shell === name) ?? "bash";
}

function loadFromOptions(requested: string | undefined, file: string | undefined, io: Io): LoadedHistory {
  const shell = parseShell(requested);
  const shellHint = shell ?? (file === undefined ? shellFromEnv(io.env) : undefined);
  return loadHistory({ file, shell: shellHint, home: io.home });
}

function runSuggest(args: string[], io: Io): number {
  const { values } = parseArgs({
    args,
    options: {
      shell: { type: "string" },
      file: { type: "string" },
      "min-count": { type: "string" },
      "min-length": { type: "string" },
      top: { type: "string" },
      json: { type: "boolean" },
    },
    strict: true,
  });
  const options = {
    minCount: positiveInt("--min-count", values["min-count"], 5),
    minLength: positiveInt("--min-length", values["min-length"], 8),
    top: positiveInt("--top", values.top, 10),
  };
  const history = loadFromOptions(values.shell, values.file, io);
  const isTaken = createEnvironment({ shell: history.shell, home: io.home, path: io.env.PATH ?? "" });
  const suggestions = suggest(history.entries, isTaken, { ...options, shell: history.shell });

  io.out(
    values.json
      ? renderJson({ shell: history.shell, historyEntries: history.entries.length, suggestions })
      : renderReport(history.shell, suggestions),
  );
  return 0;
}

function runRisks(args: string[], io: Io): number {
  const { values } = parseArgs({
    args,
    options: { shell: { type: "string" }, file: { type: "string" }, json: { type: "boolean" } },
    strict: true,
  });
  const history = loadFromOptions(values.shell, values.file, io);
  const findings = scanHistory(history.entries);
  io.out(
    values.json
      ? renderRisksJson({ shell: history.shell, historyEntries: history.entries.length, findings })
      : renderRisks(findings, history.entries.length),
  );
  return 0;
}

function describeApply(result: ApplyResult, dryRun: boolean): string {
  const names = (status: string): string =>
    result.changes.filter((c) => c.status === status).map((c) => c.name).join(", ");
  const lines = [`Target: ${result.rcPath}`];
  if (names("added")) lines.push(`Added: ${names("added")}`);
  if (names("unchanged")) lines.push(`Already present: ${names("unchanged")}`);
  if (result.skipped.length > 0) lines.push(`Skipped (every proposed name clashes): ${result.skipped.join("; ")}`);
  if (result.diff === "") {
    lines.push("Nothing to change.");
  } else if (dryRun) {
    lines.push("", result.diff, "", "Dry run: nothing was written.");
  } else {
    lines.push(result.backupPath ? `Backup: ${result.backupPath}` : "No backup needed: the file did not exist.");
    lines.push("Open a new shell or source the file to use the new definitions.");
  }
  return lines.join("\n");
}

function runApply(args: string[], io: Io): number {
  const { values } = parseArgs({
    args,
    options: {
      shell: { type: "string" },
      file: { type: "string" },
      select: { type: "string" },
      "dry-run": { type: "boolean" },
      "min-count": { type: "string" },
      "min-length": { type: "string" },
      top: { type: "string" },
    },
    strict: true,
  });
  if (values.shell === undefined) throw new UsageError("apply needs --shell bash|zsh|fish (it decides which rc file is edited)");
  const options = {
    minCount: positiveInt("--min-count", values["min-count"], 5),
    minLength: positiveInt("--min-length", values["min-length"], 8),
    top: positiveInt("--top", values.top, 10),
  };
  const history = loadFromOptions(values.shell, values.file, io);
  const isTaken = createEnvironment({ shell: history.shell, home: io.home, path: io.env.PATH ?? "" });
  const suggestions = suggest(history.entries, isTaken, { ...options, shell: history.shell });
  const selected = selectSuggestions(suggestions, values.select);
  const dryRun = values["dry-run"] === true;
  const result = applyToRc({
    shell: history.shell,
    rcPath: rcPathFor(history.shell, io.home, io.env),
    selected,
    explicitNames: values.select !== undefined,
    dryRun,
    now: new Date(),
  });
  io.out(selected.length === 0 ? "No alias suggestions to apply." : describeApply(result, dryRun));
  return 0;
}

function runStats(args: string[], io: Io): number {
  const { values } = parseArgs({
    args,
    options: { shell: { type: "string" }, file: { type: "string" }, top: { type: "string" }, json: { type: "boolean" } },
    strict: true,
  });
  const top = positiveInt("--top", values.top, 10);
  const history = loadFromOptions(values.shell, values.file, io);
  const stats = computeStats(history.entries, top);
  io.out(values.json ? JSON.stringify({ shell: history.shell, ...stats }, null, 2) : renderStats(history.shell, stats));
  return 0;
}

function isUsageError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return error instanceof UsageError || code.startsWith("ERR_PARSE_ARGS");
}

function dispatch(command: string, rest: string[], io: Io): number {
  if (command === "suggest") return runSuggest(rest, io);
  if (command === "risks") return runRisks(rest, io);
  if (command === "apply") return runApply(rest, io);
  if (command === "stats") return runStats(rest, io);
  io.err(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

export function run(args: string[], io: Io = defaultIo()): number {
  const [command, ...rest] = args;
  if (command === "--version" || command === "-v") {
    io.out(VERSION);
    return 0;
  }
  if (command === undefined || command === "--help" || command === "-h") {
    io.out(HELP);
    return 0;
  }
  try {
    return dispatch(command, rest, io);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return isUsageError(error) ? 2 : 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
