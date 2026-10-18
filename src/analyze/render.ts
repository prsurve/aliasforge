import type { Shell } from "../history/types.js";
import { VAR } from "./templates.js";

export interface Definable {
  kind: "alias" | "function";
  name: string;
  command: string;
}

function posixQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function fishQuote(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function functionBody(shell: Shell, command: string): string {
  const positional = shell === "fish" ? "$argv[1]" : '"$1"';
  return command.split(VAR).join(positional);
}

/** Ready-to-paste definition for one suggestion in the given shell's dialect. */
export function renderDefinition(shell: Shell, item: Definable): string {
  if (item.kind === "alias") {
    return shell === "fish"
      ? `alias ${item.name} ${fishQuote(item.command)}`
      : `alias ${item.name}=${posixQuote(item.command)}`;
  }
  const body = functionBody(shell, item.command);
  return shell === "fish"
    ? `function ${item.name}\n    ${body}\nend`
    : `${item.name}() { ${body}; }`;
}
