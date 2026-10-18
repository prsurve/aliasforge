import { splitLines, toText } from "./text.js";
import type { HistoryEntry, HistoryInput } from "./types.js";

const TIMESTAMP_LINE = /^#(\d{9,11})$/;

/**
 * Parse ~/.bash_history. One command per line; with HISTTIMEFORMAT set,
 * a `#<epoch>` line precedes each command.
 */
export function parseBash(input: HistoryInput): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let pending: number | undefined;

  for (const line of splitLines(toText(input))) {
    const stamp = TIMESTAMP_LINE.exec(line);
    if (stamp) {
      pending = Number(stamp[1]);
      continue;
    }
    if (line.trim() === "") continue;
    entries.push(pending === undefined ? { command: line } : { command: line, timestamp: pending });
    pending = undefined;
  }
  return entries;
}
