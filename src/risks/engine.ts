import { normalizeCommand } from "../analyze/normalize.js";
import type { HistoryEntry } from "../history/types.js";
import { maskRanges, type Range, shorten } from "./mask.js";
import { packs as defaultPacks } from "./packs/index.js";
import type { Finding, Pack, Pattern } from "./types.js";

/** Longer command lines are scanned only up to this many characters. */
const MAX_SCAN_LENGTH = 10_000;

interface Rule {
  pattern: Pattern;
  regex: RegExp;
}

interface SecretHit {
  pattern: Pattern;
  range: Range;
}

function compile(pattern: Pattern): Rule {
  const flags = [...new Set(`${pattern.flags ?? ""}gd`)].join("");
  return { pattern, regex: new RegExp(pattern.pattern, flags) };
}

function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

function secretRange(match: RegExpExecArray): Range {
  const group = match.indices?.groups?.secret;
  return group ? { start: group[0], end: group[1] } : { start: match.index, end: match.index + match[0].length };
}

/** Secret matches in rule order. A later match overlapping an earlier one is dropped. */
function findSecrets(text: string, rules: Rule[]): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { pattern, regex } of rules) {
    for (const match of text.matchAll(regex)) {
      const range = secretRange(match);
      if (range.end > range.start && !hits.some((hit) => overlaps(hit.range, range))) {
        hits.push({ pattern, range });
      }
    }
  }
  return hits;
}

function isoDate(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function toFinding(pattern: Pattern, entry: number, timestamp: number | undefined, preview: string): Finding {
  const finding: Finding = {
    id: pattern.id,
    category: pattern.category,
    severity: pattern.severity,
    title: pattern.title,
    advice: pattern.advice,
    entry,
    preview,
  };
  const date = isoDate(timestamp);
  return date === undefined ? finding : { ...finding, date };
}

function hasMatch(text: string, rule: Rule): boolean {
  rule.regex.lastIndex = 0;
  return rule.regex.test(text);
}

/**
 * Scan history entries for dangerous commands and secrets. Pure text matching:
 * nothing from history is ever executed. Every preview has secrets masked.
 */
export function scanHistory(entries: HistoryEntry[], packList: Pack[] = defaultPacks): Finding[] {
  const rules = packList.flatMap((pack) => pack.patterns).map(compile);
  const secretRules = rules.filter((rule) => rule.pattern.category === "secret");
  const dangerRules = rules.filter((rule) => rule.pattern.category === "danger");
  const findings: Finding[] = [];

  entries.forEach((entry, index) => {
    const text = normalizeCommand(entry.command).slice(0, MAX_SCAN_LENGTH);
    if (text === "") return;
    const secrets = findSecrets(text, secretRules);
    const preview = shorten(maskRanges(text, secrets.map((hit) => hit.range)));
    const matched = [
      ...secrets.map((hit) => hit.pattern),
      ...dangerRules.filter((rule) => hasMatch(text, rule)).map((rule) => rule.pattern),
    ];
    for (const pattern of matched) findings.push(toFinding(pattern, index + 1, entry.timestamp, preview));
  });
  return findings;
}
