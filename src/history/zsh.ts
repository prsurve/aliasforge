import { splitLines, toText } from "./text.js";
import type { HistoryEntry, HistoryInput } from "./types.js";

const META = 0x83;
const EXTENDED_LINE = /^: (\d+):\d+;(.*)$/;

/**
 * Zsh stores bytes 0x00 and 0x83-0x9f as a Meta byte (0x83) followed by
 * the original byte XOR 0x20. Undo that before decoding as UTF-8.
 */
export function unmetafy(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    if (byte === META) {
      i++;
      if (i < bytes.length) out[length++] = (bytes[i] as number) ^ 0x20;
    } else {
      out[length++] = byte;
    }
  }
  return out.subarray(0, length);
}

/**
 * Parse ~/.zsh_history, plain or extended (`: 1700000000:0;command`).
 * A line ending in a backslash continues on the next line.
 */
export function parseZsh(input: HistoryInput): HistoryEntry[] {
  const text = toText(typeof input === "string" ? input : unmetafy(input));
  const entries: HistoryEntry[] = [];
  let parts: string[] = [];
  let timestamp: number | undefined;

  const flush = (): void => {
    const command = parts.join("\n");
    if (command.trim() !== "") {
      entries.push(timestamp === undefined ? { command } : { command, timestamp });
    }
    parts = [];
    timestamp = undefined;
  };

  for (const line of splitLines(text)) {
    if (parts.length === 0) {
      const extended = EXTENDED_LINE.exec(line);
      if (extended) timestamp = Number(extended[1]);
      parts.push(extended ? (extended[2] as string) : line);
    } else {
      parts.push(line);
    }

    const last = parts[parts.length - 1] as string;
    if (last.endsWith("\\")) {
      parts[parts.length - 1] = last.slice(0, -1);
    } else {
      flush();
    }
  }
  if (parts.length > 0) flush();
  return entries;
}
