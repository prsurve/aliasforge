/** Trim, collapse whitespace (newlines included) and strip a trailing backslash. */
export function normalizeCommand(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/(?:\s*\\)+$/, "").trim();
}

export function isFlag(token: string): boolean {
  return token.startsWith("-") && token.length > 1;
}

type DelimiterAt = (text: string, index: number) => number;

/** Split text on delimiters that sit outside quotes. Empty parts are dropped. */
function splitUnquoted(text: string, delimiterAt: DelimiterAt): string[] {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  let i = 0;

  while (i < text.length) {
    const char = text[i] as string;
    const escaped = char === "\\" && quote !== "'" && i + 1 < text.length;
    if (escaped) {
      current += char + (text[i + 1] as string);
      i += 2;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') {
      quote = char;
    } else {
      const length = delimiterAt(text, i);
      if (length > 0) {
        parts.push(current);
        current = "";
        i += length;
        continue;
      }
    }
    current += char;
    i++;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function operatorAt(text: string, index: number): number {
  const pair = text.slice(index, index + 2);
  if (pair === "&&" || pair === "||") return 2;
  return text[index] === "|" || text[index] === ";" ? 1 : 0;
}

function whitespaceAt(text: string, index: number): number {
  return /\s/.test(text[index] as string) ? 1 : 0;
}

/** Split a command line on `&&`, `||`, `|` and `;` outside quotes. */
export function splitSubcommands(command: string): string[] {
  return splitUnquoted(command, operatorAt);
}

/** Split into words on whitespace outside quotes. Quotes stay in the tokens. */
export function tokenize(command: string): string[] {
  return splitUnquoted(command, whitespaceAt);
}

/**
 * True when quotes, parentheses, braces and backticks outside quotes pair up.
 * Used to keep text that would break a shell function body out of rc files.
 */
export function isBalanced(command: string): boolean {
  let quote = "";
  let parens = 0;
  let braces = 0;
  let backticks = 0;
  for (let i = 0; i < command.length; i++) {
    const char = command[i] as string;
    if (char === "\\" && quote !== "'") {
      if (i + 1 >= command.length) return false;
      i++;
    } else if (quote) {
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "`") {
      backticks++;
    } else if (char === "(" || char === ")") {
      parens += char === "(" ? 1 : -1;
    } else if (char === "{" || char === "}") {
      braces += char === "{" ? 1 : -1;
    }
    if (parens < 0 || braces < 0) return false;
  }
  return quote === "" && parens === 0 && braces === 0 && backticks % 2 === 0;
}
