import type { IsTaken } from "./environment.js";
import { isFlag, tokenize } from "./normalize.js";
import { type Candidate, kindOf, VAR } from "./templates.js";

const MAX_NAME_LENGTH = 5;
const MAX_OPTIONS = 3;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ALIAS_NAME = /^[A-Za-z0-9_.-]+$/;

/** Well-known short names, keyed by the exact command they stand for. */
const CONVENTIONS: Record<string, string[]> = {
  git: ["g"],
  kubectl: ["k"],
  docker: ["d"],
  "git status": ["gs", "gst"],
  "git add": ["ga"],
  "git add .": ["gaa", "gad"],
  "git commit": ["gc", "gci"],
  "git commit -m": ["gcm"],
  "git checkout": ["gco"],
  "git diff": ["gd"],
  "git pull": ["gpl", "gl"],
  "git push": ["gp", "gps"],
  "git log": ["glg", "gl"],
  "git log --oneline": ["glo"],
  "docker ps": ["dps"],
  "docker compose up": ["dcu"],
  "docker compose down": ["dcd"],
  "kubectl get pods": ["kgp"],
  "ls -la": ["ll", "la"],
  "cd ..": ["..", "up"],
  "npm test": ["nt"],
  "npm install": ["ni"],
  "npm run dev": ["nrd"],
  "npm run build": ["nrb"],
};

function firstAlnum(word: string): string {
  return /[A-Za-z0-9]/.exec(word)?.[0].toLowerCase() ?? "";
}

function programPrefix(program: string, length: number): string {
  const base = program.slice(program.lastIndexOf("/") + 1).replace(/[^A-Za-z0-9]/g, "");
  return base.slice(0, length).toLowerCase();
}

function initials(words: string[], options: { flags: boolean; programChars: number }): string {
  const [program = "", ...rest] = words;
  const letters = rest
    .filter((word) => options.flags || !isFlag(word))
    .map(firstAlnum)
    .join("");
  return (programPrefix(program, options.programChars) + letters).slice(0, MAX_NAME_LENGTH);
}

function validFor(candidate: Candidate, name: string): boolean {
  const pattern = kindOf(candidate) === "function" ? IDENTIFIER : ALIAS_NAME;
  return pattern.test(name) && name.length < candidate.replacedLength;
}

function rawOptions(candidate: Candidate, words: string[]): string[] {
  const known = candidate.shape === "middle" ? [] : (CONVENTIONS[words.join(" ")] ?? []);
  return [
    ...known,
    initials(words, { flags: true, programChars: 1 }),
    initials(words, { flags: false, programChars: 1 }),
    initials(words, { flags: false, programChars: 2 }),
  ];
}

function withSuffix(base: string, isTaken: IsTaken): string | undefined {
  for (let n = 2; n <= 9; n++) {
    if (!isTaken(`${base}${n}`)) return `${base}${n}`;
  }
  return undefined;
}

/**
 * Propose up to three names for a candidate: known conventions first, then
 * initials. Names that collide with commands, builtins or existing aliases
 * and functions are skipped. Returns an empty list when nothing is free.
 */
export function proposeNames(candidate: Candidate, isTaken: IsTaken): string[] {
  const words = tokenize(candidate.command).filter((word) => word !== VAR);
  const options = rawOptions(candidate, words).filter((name) => validFor(candidate, name));
  const free = [...new Set(options)].filter((name) => !isTaken(name));
  if (free.length === 0 && options[0] !== undefined) {
    const suffixed = withSuffix(options[0], isTaken);
    if (suffixed !== undefined && validFor(candidate, suffixed)) free.push(suffixed);
  }
  return free.slice(0, MAX_OPTIONS);
}
