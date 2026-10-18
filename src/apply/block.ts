import type { Shell } from "../history/types.js";

export const START = "# >>> aliasforge >>>";
export const END = "# <<< aliasforge <<<";
const NOTE = "# Managed by aliasforge. `aliasforge apply` edits only this block.";

/** The rc file has a damaged managed block. Nothing is written when this is thrown. */
export class BlockError extends Error {}

/** One definition in the block: an alias, a function, or an unrecognized line. */
export interface Item {
  name?: string;
  lines: string[];
}

interface Parsed {
  lines: string[];
  eol: string;
}

interface Located {
  start: number;
  end: number;
}

function parse(content: string): Parsed {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return { lines, eol };
}

function indexesOf(lines: string[], marker: string): number[] {
  return lines.flatMap((line, index) => (line.trimEnd() === marker ? [index] : []));
}

function locate(lines: string[]): Located | undefined {
  const starts = indexesOf(lines, START);
  const ends = indexesOf(lines, END);
  if (starts.length === 0 && ends.length === 0) return undefined;
  const [start] = starts;
  const [end] = ends;
  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || start > end) {
    throw new BlockError(
      `The aliasforge block is damaged (expected exactly one "${START}" before one "${END}"). Fix it by hand; nothing was changed.`,
    );
  }
  return { start, end };
}

const ALIAS_LINE = /^alias\s+([^\s=]+)/;
const FISH_FUNCTION = /^function\s+(\S+)/;
const POSIX_FUNCTION = /^([A-Za-z_]\w*)\(\)\s*\{/;

/** Split block lines into items. Multi-line fish functions stay together. */
export function parseItems(lines: string[], shell: Shell): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "" || line === NOTE) continue;
    const fn = shell === "fish" ? FISH_FUNCTION.exec(line) : null;
    if (fn) {
      const close = lines.findIndex((candidate, at) => at > i && candidate.trim() === "end");
      const last = close === -1 ? lines.length - 1 : close;
      items.push({ name: fn[1] as string, lines: lines.slice(i, last + 1) });
      i = last;
      continue;
    }
    const match = ALIAS_LINE.exec(line) ?? POSIX_FUNCTION.exec(line);
    items.push(match ? { name: match[1] as string, lines: [line] } : { lines: [line] });
  }
  return items;
}

/** Items in the managed block of an rc file's text. Empty when there is no block. */
export function readItems(content: string, shell: Shell): Item[] {
  const { lines } = parse(content);
  const located = locate(lines);
  return located ? parseItems(lines.slice(located.start + 1, located.end), shell) : [];
}

/** The text with the managed block removed (unchanged if absent or damaged). */
export function stripManagedBlock(content: string): string {
  const { lines } = parse(content);
  try {
    const located = locate(lines);
    if (!located) return content;
    return [...lines.slice(0, located.start), ...lines.slice(located.end + 1)].join("\n");
  } catch {
    return content;
  }
}

export interface Change {
  name: string;
  status: "added" | "unchanged";
}

/** Add incoming items the block lacks. Items with the same name and text are unchanged. */
export function mergeItems(existing: Item[], incoming: Item[]): { items: Item[]; changes: Change[] } {
  const items = [...existing];
  const changes: Change[] = [];
  for (const item of incoming) {
    const name = item.name as string;
    const found = items.some((current) => current.name === name && current.lines.join("\n") === item.lines.join("\n"));
    if (!found) items.push(item);
    changes.push({ name, status: found ? "unchanged" : "added" });
  }
  return { items, changes };
}

/** Insert or replace the managed block in the rc text, leaving everything else untouched. */
export function writeItems(content: string, items: Item[]): string {
  const { lines, eol } = parse(content);
  const block = [START, NOTE, ...items.flatMap((item) => item.lines), END];
  const located = locate(lines);
  let next: string[];
  if (located) {
    next = [...lines.slice(0, located.start), ...block, ...lines.slice(located.end + 1)];
  } else {
    const spacer = lines.length > 0 && (lines[lines.length - 1] as string).trim() !== "" ? [""] : [];
    next = [...lines, ...spacer, ...block];
  }
  return next.join(eol) + eol;
}
