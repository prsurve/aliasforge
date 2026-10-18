import { UsageError } from "../errors.js";
import type { Suggestion } from "../analyze/suggest.js";

export interface Selected {
  suggestion: Suggestion;
  /** The name to use. Defaults to the first option unless `--select` named another. */
  name: string;
}

/**
 * Pick suggestions by `--select`: a comma-separated list of ranks (from the
 * `suggest` table) and/or proposed names. No selection means all of them.
 */
export function selectSuggestions(suggestions: Suggestion[], spec: string | undefined): Selected[] {
  if (spec === undefined || spec.trim() === "") {
    return suggestions.map((suggestion) => ({ suggestion, name: suggestion.names[0] as string }));
  }
  return spec.split(",").map((raw) => pick(suggestions, raw.trim()));
}

function pick(suggestions: Suggestion[], token: string): Selected {
  if (/^\d+$/.test(token)) {
    const suggestion = suggestions.find((s) => s.rank === Number(token));
    if (!suggestion) throw new UsageError(`--select: no suggestion with rank ${token}`);
    return { suggestion, name: suggestion.names[0] as string };
  }
  const suggestion = suggestions.find((s) => s.names.includes(token));
  if (!suggestion) throw new UsageError(`--select: "${token}" is not a rank or proposed name`);
  return { suggestion, name: token };
}
