import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderDefinition } from "../analyze/render.js";
import type { Shell } from "../history/types.js";
import { createBackup } from "./backup.js";
import { type Change, type Item, mergeItems, readItems, writeItems } from "./block.js";
import { unifiedDiff } from "./diff.js";
import type { Selected } from "./select.js";

export function rcPathFor(shell: Shell, home: string, env: NodeJS.ProcessEnv): string {
  if (shell === "bash") return join(home, ".bashrc");
  if (shell === "zsh") return join(env.ZDOTDIR || home, ".zshrc");
  return join(home, ".config", "fish", "config.fish");
}

export interface ApplyInput {
  shell: Shell;
  rcPath: string;
  selected: Selected[];
  /** True when the user named this exact name with --select, so it is not swapped. */
  explicitNames: boolean;
  dryRun: boolean;
  now: Date;
}

export interface ApplyResult {
  rcPath: string;
  changes: Change[];
  /** Suggestions left out because every proposed name clashed with the block. */
  skipped: string[];
  diff: string;
  backupPath?: string;
  written: boolean;
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function itemFor(shell: Shell, selected: Selected, name: string): Item {
  const { kind, command } = selected.suggestion;
  return { name, lines: renderDefinition(shell, { kind, name, command }).split("\n") };
}

/** Choose a name per selection that does not clash with a different definition in the block. */
function resolve(shell: Shell, selected: Selected[], existing: Item[], explicit: boolean): { incoming: Item[]; skipped: string[] } {
  const taken = new Map(existing.flatMap((item) => (item.name ? [[item.name, item.lines.join("\n")] as const] : [])));
  const incoming: Item[] = [];
  const skipped: string[] = [];
  for (const choice of selected) {
    const names = explicit ? [choice.name] : choice.suggestion.names;
    const item = names
      .map((name) => itemFor(shell, choice, name))
      .find((candidate) => {
        const current = taken.get(candidate.name as string);
        return current === undefined || current === candidate.lines.join("\n");
      });
    if (!item) {
      skipped.push(choice.suggestion.pattern);
      continue;
    }
    taken.set(item.name as string, item.lines.join("\n"));
    incoming.push(item);
  }
  return { incoming, skipped };
}

/**
 * Write the selected definitions into the managed block of the rc file.
 * Existing definitions in the block are kept. A timestamped backup is made
 * before any change, and nothing is touched when the result would be identical.
 */
export function applyToRc(input: ApplyInput): ApplyResult {
  const current = readIfExists(input.rcPath);
  const content = current ?? "";
  const existing = readItems(content, input.shell);
  const { incoming, skipped } = resolve(input.shell, input.selected, existing, input.explicitNames);
  const merged = mergeItems(existing, incoming);
  const next = incoming.length === 0 ? content : writeItems(content, merged.items);
  const result: ApplyResult = {
    rcPath: input.rcPath,
    changes: merged.changes,
    skipped,
    diff: unifiedDiff(input.rcPath, content, next),
    written: false,
  };
  if (next === content || input.dryRun) return result;

  const backupPath = current === undefined ? undefined : createBackup(input.rcPath, input.now);
  mkdirSync(dirname(input.rcPath), { recursive: true });
  writeFileSync(input.rcPath, next);
  return backupPath === undefined ? { ...result, written: true } : { ...result, written: true, backupPath };
}
