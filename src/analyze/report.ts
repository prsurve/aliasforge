import type { Shell } from "../history/types.js";
import type { Suggestion } from "./suggest.js";

const HEADERS = ["#", "Score", "Count", "Pattern", "Names"];

function rows(suggestions: Suggestion[]): string[][] {
  return suggestions.map((s) => [
    String(s.rank),
    String(s.score),
    String(s.count),
    s.kind === "function" ? `${s.pattern}  (function)` : s.pattern,
    s.names.join(", "),
  ]);
}

function table(suggestions: Suggestion[]): string {
  const all = [HEADERS, ...rows(suggestions)];
  const widths = HEADERS.map((_, col) => Math.max(...all.map((row) => (row[col] as string).length)));
  return all
    .map((row) => row.map((cell, col) => cell.padEnd(widths[col] as number)).join("  ").trimEnd())
    .join("\n");
}

/** Ranked table followed by a copy-paste block for the shell. */
export function renderReport(shell: Shell, suggestions: Suggestion[]): string {
  if (suggestions.length === 0) return "No alias suggestions. Try lowering --min-count or --min-length.";
  const block = ["# aliasforge suggestions", ...suggestions.map((s) => s.definition)].join("\n");
  return `${table(suggestions)}\n\nCopy-paste for ${shell}:\n\n${block}`;
}

export interface JsonReport {
  shell: Shell;
  historyEntries: number;
  suggestions: Suggestion[];
}

export function renderJson(report: JsonReport): string {
  return JSON.stringify(report, null, 2);
}
