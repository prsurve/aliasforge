import type { Shell } from "../history/types.js";
import type { Finding, Severity } from "./types.js";

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.entry - b.entry);
}

function formatFinding(finding: Finding): string {
  const when = finding.date ? ` on ${finding.date}` : "";
  return [
    `[${finding.severity.toUpperCase()}] ${finding.title}`,
    `  entry #${finding.entry}${when}`,
    `  ${finding.preview}`,
    `  -> ${finding.advice}`,
  ].join("\n");
}

const SECRET_NOTE =
  "Rotate every credential listed above, then remove those entries from your history file. aliasforge never edits it.";

export function renderRisks(findings: Finding[], entryCount: number): string {
  if (findings.length === 0) return `No risky commands or secrets found in ${entryCount} history entries.`;
  const secrets = findings.filter((f) => f.category === "secret").length;
  const lines = [
    `${findings.length} finding(s) in ${entryCount} history entries (${secrets} secret, ${findings.length - secrets} dangerous).`,
    "",
    sortFindings(findings).map(formatFinding).join("\n\n"),
  ];
  if (secrets > 0) lines.push("", SECRET_NOTE);
  return lines.join("\n");
}

export interface RisksJson {
  shell: Shell;
  historyEntries: number;
  findings: Finding[];
}

export function renderRisksJson(report: RisksJson): string {
  return JSON.stringify({ ...report, findings: sortFindings(report.findings) }, null, 2);
}
