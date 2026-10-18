import type { HistoryEntry, Shell } from "../history/types.js";
import type { IsTaken } from "./environment.js";
import { proposeNames } from "./naming.js";
import { normalizeCommand, splitSubcommands } from "./normalize.js";
import { renderDefinition } from "./render.js";
import { aliasScore } from "./score.js";
import { buildCandidates, type Candidate, kindOf } from "./templates.js";

export interface SuggestOptions {
  shell: Shell;
  minCount: number;
  minLength: number;
  top: number;
}

export interface Suggestion {
  rank: number;
  kind: "alias" | "function";
  pattern: string;
  count: number;
  score: number;
  /** Name options. The first one is used in `definition`. */
  names: string[];
  definition: string;
}

/** Candidates scored and named, before the final selection. */
interface Named {
  candidate: Candidate;
  names: string[];
  score: number;
}

/** Full normalized line plus its sub-commands, each counted once per entry. */
function unitsOf(entry: HistoryEntry): string[] {
  const line = normalizeCommand(entry.command);
  if (line === "" || line.startsWith("#")) return [];
  return [...new Set([line, ...splitSubcommands(line)])];
}

function candidatePool(entries: HistoryEntry[], options: SuggestOptions): Candidate[] {
  const units = entries.map(unitsOf).filter((list) => list.length > 0);
  const eligible = buildCandidates(units).filter(
    (c) => c.count >= options.minCount && c.replacedLength >= options.minLength,
  );
  const upperBound = (c: Candidate): number => c.count * c.replacedLength;
  eligible.sort((a, b) => upperBound(b) - upperBound(a));
  return eligible.slice(0, Math.max(options.top * 10, 100));
}

function nameAndScore(candidate: Candidate, isTaken: IsTaken): Named | undefined {
  const names = proposeNames(candidate, isTaken);
  const first = names[0];
  if (first === undefined) return undefined;
  return { candidate, names, score: aliasScore(candidate, first) };
}

/** An exact command already covered by a chosen `<prefix> <arg>` alias. */
function isCovered(candidate: Candidate, chosen: Named[]): boolean {
  if (candidate.shape !== "exact") return false;
  const prefix = candidate.command.slice(0, candidate.command.lastIndexOf(" "));
  return chosen.some((c) => c.candidate.shape === "trailing" && c.candidate.command === prefix);
}

function select(named: Named[], top: number): Named[] {
  const chosen: Named[] = [];
  const used = new Set<string>();
  for (const item of named) {
    if (chosen.length >= top) break;
    const name = item.names.find((n) => !used.has(n));
    if (name === undefined || isCovered(item.candidate, chosen)) continue;
    used.add(name);
    chosen.push({ ...item, names: [name, ...item.names.filter((n) => n !== name)] });
  }
  return chosen;
}

function toSuggestion(item: Named, rank: number, shell: Shell): Suggestion {
  const { candidate, names } = item;
  const kind = kindOf(candidate);
  const name = names[0] as string;
  return {
    rank,
    kind,
    pattern: candidate.pattern,
    count: candidate.count,
    score: aliasScore(candidate, name),
    names,
    definition: renderDefinition(shell, { kind, name, command: candidate.command }),
  };
}

/** Rank alias and function suggestions from parsed history. */
export function suggest(entries: HistoryEntry[], isTaken: IsTaken, options: SuggestOptions): Suggestion[] {
  const named = candidatePool(entries, options)
    .map((candidate) => nameAndScore(candidate, isTaken))
    .filter((item): item is Named => item !== undefined && item.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.pattern.localeCompare(b.candidate.pattern));

  return select(named, options.top).map((item, index) => toSuggestion(item, index + 1, options.shell));
}
