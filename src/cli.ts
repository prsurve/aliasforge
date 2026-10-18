#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createEnvironment } from "./analyze/environment.js";
import { renderJson, renderReport } from "./analyze/report.js";
import { suggest } from "./analyze/suggest.js";
import { loadHistory, type Shell } from "./history/index.js";

const VERSION = "0.0.0";
const SHELLS: Shell[] = ["bash", "zsh", "fish"];

const HELP = `aliasforge ${VERSION}

Usage: aliasforge <command> [options]

Commands:
  suggest   Suggest aliases from shell history
  risks     Flag dangerous commands and leaked secrets (not implemented yet)
  apply     Write chosen aliases to a managed block in your rc file (not implemented yet)
  stats     Show history size, top commands and time span (not implemented yet)

suggest options:
  --shell bash|zsh|fish   Shell dialect (default: from --file or $SHELL)
  --file <path>           Read this history file instead of the default
  --min-count N           Minimum occurrences (default 5)
  --min-length N          Minimum command length in characters (default 8)
  --top N                 Number of suggestions (default 10)
  --json                  Machine-readable output
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

class UsageError extends Error {}

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
  const requested = parseShell(values.shell);
  const options = {
    minCount: positiveInt("--min-count", values["min-count"], 5),
    minLength: positiveInt("--min-length", values["min-length"], 8),
    top: positiveInt("--top", values.top, 10),
  };
  const shellHint = requested ?? (values.file === undefined ? shellFromEnv(io.env) : undefined);
  const history = loadHistory({ file: values.file, shell: shellHint, home: io.home });
  const isTaken = createEnvironment({ shell: history.shell, home: io.home, path: io.env.PATH ?? "" });
  const suggestions = suggest(history.entries, isTaken, { ...options, shell: history.shell });

  io.out(
    values.json
      ? renderJson({ shell: history.shell, historyEntries: history.entries.length, suggestions })
      : renderReport(history.shell, suggestions),
  );
  return 0;
}

function isUsageError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return error instanceof UsageError || code.startsWith("ERR_PARSE_ARGS");
}

function dispatch(command: string, rest: string[], io: Io): number {
  if (command === "suggest") return runSuggest(rest, io);
  if (["risks", "apply", "stats"].includes(command)) {
    io.err(`aliasforge ${command} is not implemented yet`);
    return 1;
  }
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
