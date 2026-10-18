import { readFileSync } from "node:fs";
import { parseBash } from "./bash.js";
import { defaultHistoryPath, detectShell } from "./detect.js";
import { parseFish } from "./fish.js";
import type { HistoryEntry, HistoryInput, Shell } from "./types.js";
import { parseZsh } from "./zsh.js";

export type { HistoryEntry, HistoryInput, Shell } from "./types.js";
export { defaultHistoryPath, detectShell } from "./detect.js";
export { parseBash, parseFish, parseZsh };

export function parseHistory(shell: Shell, input: HistoryInput): HistoryEntry[] {
  switch (shell) {
    case "bash":
      return parseBash(input);
    case "zsh":
      return parseZsh(input);
    case "fish":
      return parseFish(input);
  }
}

export interface LoadOptions {
  /** History file to read (`--file`). Defaults to the shell's standard path. */
  file?: string;
  shell?: Shell;
  home: string;
}

export interface LoadedHistory {
  shell: Shell;
  file: string;
  entries: HistoryEntry[];
}

/** Read and parse a history file. Never executes anything from it. */
export function loadHistory(options: LoadOptions): LoadedHistory {
  const file = options.file ?? defaultHistoryPath(options.shell ?? "bash", options.home);
  const bytes = readFileSync(file);
  const shell = options.shell ?? detectShell(file, bytes);
  return { shell, file, entries: parseHistory(shell, bytes) };
}
