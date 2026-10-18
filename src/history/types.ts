export type Shell = "bash" | "zsh" | "fish";

export interface HistoryEntry {
  /** The command text. Multi-line commands keep "\n" between lines. */
  command: string;
  /** Unix time in seconds, when the history file recorded one. */
  timestamp?: number;
}

export type HistoryInput = string | Uint8Array;
