import type { HistoryEntry } from "../history/types.js";
import { normalizeCommand, splitSubcommands, tokenize } from "./normalize.js";

const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** Words that run another command, so the real program is the next word. */
const WRAPPERS = new Set(["sudo", "doas", "time", "nohup", "command", "env", "exec", "nice", "builtin"]);
/** Shell syntax that can start a sub-command without being a program. */
const SYNTAX = new Set(["do", "then", "else", "elif", "!", "{", "(", "if", "while", "until"]);
const DAY_SECONDS = 86_400;

export interface CommandCount {
  command: string;
  count: number;
}

export interface Stats {
  historyEntries: number;
  uniqueCommands: number;
  /** Entries that carry a time in the history file. */
  timestampedEntries: number;
  /** YYYY-MM-DD (UTC) of the earliest and latest timestamp. */
  firstDate?: string;
  lastDate?: string;
  /** Whole days from the first to the last timestamp. */
  spanDays?: number;
  topCommands: CommandCount[];
}

interface WrapperOptions {
  /** Single-letter options that take a value. */
  short: string;
  /** Long options that take a value (as a separate word when written without `=`). */
  long: string[];
}

/** Options of each wrapper that consume the next word, so it is not mistaken for the program. */
const WRAPPER_OPTIONS: Record<string, WrapperOptions> = {
  sudo: {
    short: "ughpCDRTUrt",
    long: ["--user", "--group", "--host", "--prompt", "--close-from", "--chdir", "--chroot", "--command-timeout", "--other-user", "--role", "--type"],
  },
  doas: { short: "uC", long: [] },
  env: { short: "uCS", long: ["--unset", "--chdir", "--split-string"] },
  nice: { short: "n", long: ["--adjustment"] },
  time: { short: "fo", long: ["--format", "--output"] },
  exec: { short: "a", long: [] },
};

/** Number of words an option word uses: 1 alone, 2 when its value is the next word. */
function optionWidth(option: string, wrapper: WrapperOptions): number {
  if (option.startsWith("--")) {
    return !option.includes("=") && wrapper.long.includes(option) ? 2 : 1;
  }
  const letters = option.slice(1);
  if (letters === "") return 1;
  const at = [...letters].findIndex((letter) => wrapper.short.includes(letter));
  // `-uroot` carries its value; `-Eu` and `-u` take the next word.
  return at === letters.length - 1 ? 2 : 1;
}

function skipWrapperOptions(tokens: string[], start: number, wrapperName: string): number {
  const wrapper = WRAPPER_OPTIONS[wrapperName] ?? { short: "", long: [] };
  let i = start;
  while (i < tokens.length && (tokens[i] as string).startsWith("-")) {
    const token = tokens[i] as string;
    if (token === "--") return i + 1;
    i += optionWidth(token, wrapper);
  }
  return i;
}

/** The program a sub-command runs, skipping `VAR=x`, `sudo`, `time` and similar. */
export function programOf(unit: string): string | undefined {
  const tokens = tokenize(unit);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (ASSIGNMENT.test(token) || SYNTAX.has(token)) {
      i++;
    } else if (WRAPPERS.has(token)) {
      i = skipWrapperOptions(tokens, i + 1, token);
    } else {
      break;
    }
  }
  const program = tokens[i];
  if (program === undefined || program.startsWith("#")) return undefined;
  return program.slice(program.lastIndexOf("/") + 1) || undefined;
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function validTimestamps(entries: HistoryEntry[]): number[] {
  return entries.flatMap((entry) => {
    const t = entry.timestamp;
    return t !== undefined && Number.isFinite(t) && !Number.isNaN(new Date(t * 1000).getTime()) ? [t] : [];
  });
}

function countPrograms(entries: HistoryEntry[]): CommandCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const unit of splitSubcommands(normalizeCommand(entry.command))) {
      const program = programOf(unit);
      if (program !== undefined) counts.set(program, (counts.get(program) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

/** Summarize parsed history: size, most-used programs and time span. */
export function computeStats(entries: HistoryEntry[], top: number): Stats {
  const unique = new Set(entries.map((entry) => normalizeCommand(entry.command)));
  unique.delete("");
  const times = validTimestamps(entries);
  const stats: Stats = {
    historyEntries: entries.length,
    uniqueCommands: unique.size,
    timestampedEntries: times.length,
    topCommands: countPrograms(entries).slice(0, top),
  };
  if (times.length === 0) return stats;
  const first = times.reduce((a, b) => Math.min(a, b));
  const last = times.reduce((a, b) => Math.max(a, b));
  return {
    ...stats,
    firstDate: isoDate(first),
    lastDate: isoDate(last),
    spanDays: Math.floor((last - first) / DAY_SECONDS),
  };
}

export function renderStats(shell: string, stats: Stats): string {
  const lines = [
    `Shell: ${shell}`,
    `Entries: ${stats.historyEntries.toLocaleString("en-US")} (${stats.uniqueCommands.toLocaleString("en-US")} unique)`,
  ];
  if (stats.firstDate !== undefined) {
    lines.push(
      `Time span: ${stats.firstDate} to ${stats.lastDate} (${stats.spanDays} days, ${stats.timestampedEntries.toLocaleString("en-US")} entries with a time)`,
    );
  } else {
    lines.push("Time span: unknown (this history has no timestamps)");
  }
  if (stats.topCommands.length === 0) return lines.join("\n");
  const width = Math.max(...stats.topCommands.map((c) => c.command.length));
  lines.push("", "Top commands:");
  stats.topCommands.forEach((item, index) => {
    lines.push(`  ${String(index + 1).padStart(2)}  ${item.command.padEnd(width)}  ${item.count}`);
  });
  return lines.join("\n");
}
