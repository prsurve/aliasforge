import { isBalanced, isFlag, tokenize } from "./normalize.js";

export const VAR = "<arg>";

/** Longest command (in words) we try to template. Keeps the work bounded. */
const MAX_TOKENS = 12;

export type Shape = "exact" | "trailing" | "middle";

export interface Candidate {
  shape: Shape;
  /** Alias body, or for a function the command with VAR where the argument goes. */
  command: string;
  /** What the user sees, e.g. `git checkout <arg>`. */
  pattern: string;
  count: number;
  /** Characters of typed text the alias or function name replaces. */
  replacedLength: number;
}

interface Group {
  tokens: string[];
  values: Set<string>;
  count: number;
}

type Groups = Map<string, Group>;

function addToGroup(groups: Groups, tokens: string[], index: number): void {
  const template = tokens.map((token, i) => (i === index ? VAR : token));
  const key = template.join(" ");
  const group = groups.get(key) ?? { tokens: template, values: new Set<string>(), count: 0 };
  group.values.add(tokens[index] as string);
  group.count++;
  groups.set(key, group);
}

function addTemplates(trailing: Groups, middle: Groups, tokens: string[]): void {
  if (tokens.length < 2 || tokens.length > MAX_TOKENS) return;
  const last = tokens.length - 1;
  if (!isFlag(tokens[last] as string)) addToGroup(trailing, tokens, last);
  for (let i = 1; i < last; i++) {
    if (!isFlag(tokens[i] as string)) addToGroup(middle, tokens, i);
  }
}

function exactCandidates(counts: Map<string, number>): Candidate[] {
  return [...counts].map(([command, count]) => ({
    shape: "exact",
    command,
    pattern: command,
    count,
    replacedLength: command.length,
  }));
}

function trailingCandidates(groups: Groups): Candidate[] {
  return [...groups.values()]
    .filter((group) => group.values.size >= 2)
    .map((group) => {
      const command = group.tokens.slice(0, -1).join(" ");
      return {
        shape: "trailing",
        command,
        pattern: `${command} ${VAR}`,
        count: group.count,
        replacedLength: command.length,
      };
    });
}

/**
 * A function body is pasted into an rc file, so reject text that could break
 * out of it: unbalanced quotes or brackets, comments, heredocs, a trailing
 * `&`, `|` or backslash.
 */
function safeForFunction(tokens: string[]): boolean {
  const command = tokens.join(" ");
  return isBalanced(command) && !/[&|\\]$/.test(command) && !command.includes("<<") && !tokens.some((t) => t.startsWith("#"));
}

function middleCandidates(groups: Groups): Candidate[] {
  return [...groups.values()]
    .filter((group) => group.values.size >= 2 && safeForFunction(group.tokens))
    .map((group) => {
      const command = group.tokens.join(" ");
      return {
        shape: "middle",
        command,
        pattern: command,
        count: group.count,
        replacedLength: command.length - VAR.length,
      };
    });
}

/**
 * Build alias/function candidates from per-entry lists of unique command units.
 * Identical units group together; units that differ only in one argument group
 * into a template. A last-argument template stays an alias (extra words pass
 * through); a middle-argument template needs a function.
 */
export function buildCandidates(units: string[][]): Candidate[] {
  const exact = new Map<string, number>();
  const trailing: Groups = new Map();
  const middle: Groups = new Map();

  for (const entryUnits of units) {
    for (const unit of entryUnits) {
      exact.set(unit, (exact.get(unit) ?? 0) + 1);
      addTemplates(trailing, middle, tokenize(unit));
    }
  }
  return [...exactCandidates(exact), ...trailingCandidates(trailing), ...middleCandidates(middle)];
}

export function kindOf(candidate: Candidate): "alias" | "function" {
  return candidate.shape === "middle" ? "function" : "alias";
}
