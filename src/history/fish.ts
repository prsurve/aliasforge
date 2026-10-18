import { splitLines, toText } from "./text.js";
import type { HistoryEntry, HistoryInput } from "./types.js";

const CMD_LINE = /^- cmd: ?(.*)$/;
const WHEN_LINE = /^ {2}when: *(\d+)\s*$/;

/** Fish escapes backslash and newline inside `cmd:` values. */
function unescapeFish(value: string): string {
  return value.replace(/\\(.)/g, (_match, char: string) => (char === "n" ? "\n" : char));
}

/**
 * Parse fish_history: YAML-like entries (`- cmd: ...` then `  when: ...`).
 * Other keys such as `paths:` are ignored.
 */
export function parseFish(input: HistoryInput): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let current: HistoryEntry | undefined;

  for (const line of splitLines(toText(input))) {
    const cmd = CMD_LINE.exec(line);
    if (cmd) {
      const command = unescapeFish(cmd[1] as string);
      current = { command };
      if (command.trim() !== "") entries.push(current);
      continue;
    }
    const when = WHEN_LINE.exec(line);
    if (when && current) current.timestamp = Number(when[1]);
  }
  return entries;
}
