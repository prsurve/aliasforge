import type { HistoryInput } from "./types.js";

const decoder = new TextDecoder("utf-8");

/** Decode bytes as UTF-8 (invalid bytes become U+FFFD) and drop a leading BOM. */
export function toText(input: HistoryInput): string {
  const text = typeof input === "string" ? input : decoder.decode(input);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Split on LF or CRLF. A trailing newline does not produce an empty last line. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
