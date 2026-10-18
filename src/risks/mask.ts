export interface Range {
  start: number;
  end: number;
}

const PREVIEW_LENGTH = 100;

/**
 * Keep up to the first 4 characters and hide the rest. Short secrets show
 * fewer characters (a quarter of their length) so they are never exposed.
 */
export function maskSecret(secret: string): string {
  const visible = Math.min(4, Math.floor(secret.length / 4));
  return `${secret.slice(0, visible)}****`;
}

/** Replace each range of `text` with its masked form. Ranges must not overlap. */
export function maskRanges(text: string, ranges: Range[]): string {
  const ordered = [...ranges].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const range of ordered) {
    result += text.slice(cursor, range.start) + maskSecret(text.slice(range.start, range.end));
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

export function shorten(text: string, length = PREVIEW_LENGTH): string {
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}
