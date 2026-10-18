import type { Candidate } from "./templates.js";

/** Keystrokes saved overall: occurrences x (typed length - alias name length). */
export function aliasScore(candidate: Candidate, name: string): number {
  return candidate.count * (candidate.replacedLength - name.length);
}
