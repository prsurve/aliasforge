import { basename, join } from "node:path";
import { splitLines, toText } from "./text.js";
import type { HistoryInput, Shell } from "./types.js";

const SNIFF_LINES = 50;

export function defaultHistoryPath(shell: Shell, home: string): string {
  switch (shell) {
    case "bash":
      return join(home, ".bash_history");
    case "zsh":
      return join(home, ".zsh_history");
    case "fish":
      return join(home, ".local", "share", "fish", "fish_history");
  }
}

function shellFromName(path: string): Shell | undefined {
  const name = basename(path).toLowerCase();
  if (name.includes("fish")) return "fish";
  if (name.includes("zsh")) return "zsh";
  if (name.includes("bash")) return "bash";
  return undefined;
}

function shellFromContent(input: HistoryInput): Shell {
  const head = input instanceof Uint8Array ? input.subarray(0, 64 * 1024) : input.slice(0, 64 * 1024);
  const lines = splitLines(toText(head)).slice(0, SNIFF_LINES);
  if (lines.some((line) => line.startsWith("- cmd:"))) return "fish";
  if (lines.some((line) => /^: \d+:\d+;/.test(line))) return "zsh";
  return "bash";
}

/** Guess the shell from the file name first, then from the content. */
export function detectShell(path: string, input: HistoryInput): Shell {
  return shellFromName(path) ?? shellFromContent(input);
}
