export type Severity = "high" | "medium" | "low";
export type Category = "danger" | "secret";

/**
 * One detection rule, as plain data so contributors can add rules easily.
 *
 * `pattern` is a JavaScript regular expression source. For secret rules, a
 * named group `(?<secret>...)` marks the part to mask; without it the whole
 * match is masked.
 */
export interface Pattern {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  advice: string;
  pattern: string;
  flags?: string;
}

export interface Pack {
  name: string;
  patterns: Pattern[];
}

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  advice: string;
  /** 1-based position of the command in the parsed history. */
  entry: number;
  /** YYYY-MM-DD (UTC), when the history file recorded a time. */
  date?: string;
  /** The command with every detected secret masked, shortened to fit a line. */
  preview: string;
}
