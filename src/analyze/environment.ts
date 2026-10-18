import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Shell } from "../history/types.js";
import { stripManagedBlock } from "../apply/block.js";
import { isReserved } from "./reserved.js";

export type IsTaken = (name: string) => boolean;

const RC_FILES: Record<Shell, string[]> = {
  bash: [".bashrc", ".bash_profile", ".bash_aliases", ".profile"],
  zsh: [".zshrc", ".zprofile", ".zshenv"],
  fish: [".config/fish/config.fish"],
};

const ALIAS_LINE = /^\s*(?:alias|abbr)\s+(?:-\S+\s+)*([^\s=]+)/;
const FUNCTION_KEYWORD = /^\s*function\s+([^\s({;]+)/;
const FUNCTION_PARENS = /^\s*([A-Za-z_][\w.-]*)\s*\(\s*\)/;

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function namesOnPath(pathVar: string): Set<string> {
  const names = new Set<string>();
  for (const dir of pathVar.split(delimiter).filter((entry) => entry !== "")) {
    for (const file of listDir(dir)) {
      if (!names.has(file) && isExecutable(join(dir, file))) names.add(file);
    }
  }
  return names;
}

/** Names defined by alias/function/abbr lines in the given rc text. */
export function definedNames(rcText: string): Set<string> {
  const names = new Set<string>();
  for (const line of rcText.split(/\r?\n/)) {
    const match = ALIAS_LINE.exec(line) ?? FUNCTION_KEYWORD.exec(line) ?? FUNCTION_PARENS.exec(line);
    if (match) names.add(match[1] as string);
  }
  return names;
}

function fishFunctionFiles(home: string): string[] {
  const dirs = [join(home, ".config/fish/functions"), join(home, ".config/fish/conf.d")];
  return dirs.flatMap((dir) => listDir(dir).map((file) => join(dir, file)));
}

function namesFromRcFiles(shell: Shell, home: string): Set<string> {
  const files = RC_FILES[shell].map((file) => join(home, file));
  if (shell === "fish") files.push(...fishFunctionFiles(home));
  const names = new Set<string>();
  for (const file of files) {
    // Names we wrote ourselves are not collisions, or `apply` would never be idempotent.
    for (const name of definedNames(stripManagedBlock(readText(file)))) names.add(name);
    if (shell === "fish" && file.endsWith(".fish")) names.add(file.slice(file.lastIndexOf("/") + 1, -5));
  }
  return names;
}

export interface EnvironmentOptions {
  shell: Shell;
  home: string;
  /** The PATH variable to scan for existing commands. */
  path: string;
}

/**
 * Checks whether a proposed alias name would shadow something. It reads PATH
 * directories and rc files; it never runs a shell or any command.
 */
export function createEnvironment(options: EnvironmentOptions): IsTaken {
  const onPath = namesOnPath(options.path);
  const defined = namesFromRcFiles(options.shell, options.home);
  return (name) => isReserved(options.shell, name) || onPath.has(name) || defined.has(name);
}
