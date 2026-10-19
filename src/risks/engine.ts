import { commandLines } from "../analyze/normalize.js";
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

interface RuleSet {
  secrets: Rule[];
  dangers: Rule[];
}

function scanLine(text: string, entry: number, timestamp: number | undefined, rules: RuleSet): Finding[] {
  const secrets = findSecrets(text, rules.secrets);
  const preview = shorten(maskRanges(text, secrets.map((hit) => hit.range)));
  const matched = [
    ...secrets.map((hit) => hit.pattern),
    ...rules.dangers.filter((rule) => hasMatch(text, rule)).map((rule) => rule.pattern),
  ];
  return matched.map((pattern) => toFinding(pattern, entry, timestamp, preview));
}

/**
 * Scan history entries for dangerous commands and secrets. Pure text matching:
 * nothing from history is ever executed. Every preview has secrets masked.
 * An entry with several commands is scanned one command at a time.
 */
export function scanHistory(entries: HistoryEntry[], packList: Pack[] = defaultPacks): Finding[] {
  const compiled = packList.flatMap((pack) => pack.patterns).map(compile);
  const rules: RuleSet = {
    secrets: compiled.filter((rule) => rule.pattern.category === "secret"),
    dangers: compiled.filter((rule) => rule.pattern.category === "danger"),
  };
  return entries.flatMap((entry, index) =>
    commandLines(entry.command).flatMap((line) =>
      scanLine(line.slice(0, MAX_SCAN_LENGTH), index + 1, entry.timestamp, rules),
    ),
  );
}
