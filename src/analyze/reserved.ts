import type { Shell } from "../history/types.js";

const POSIX = [
  ".", ":", "[", "alias", "bg", "break", "case", "cd", "command", "continue", "do", "done", "echo",
  "elif", "else", "esac", "eval", "exec", "exit", "export", "false", "fc", "fg", "fi", "for", "getopts",
  "hash", "if", "in", "jobs", "kill", "local", "printf", "pwd", "read", "readonly", "return", "set",
  "shift", "source", "test", "then", "time", "times", "trap", "true", "type", "ulimit", "umask",
  "unalias", "unset", "until", "wait", "while",
];

const BASH = [
  "[[", "]]", "bind", "builtin", "caller", "compgen", "complete", "compopt", "coproc", "declare", "dirs",
  "disown", "enable", "function", "help", "history", "let", "logout", "mapfile", "popd", "pushd",
  "readarray", "select", "shopt", "suspend", "typeset",
];

const ZSH = [
  "[[", "autoload", "bindkey", "builtin", "chdir", "compctl", "declare", "dirs", "disable", "emulate",
  "enable", "float", "foreach", "function", "functions", "getln", "history", "integer", "let", "limit",
  "nocorrect", "noglob", "popd", "print", "private", "pushd", "r", "rehash", "repeat", "sched",
  "setopt", "stat", "typeset", "unfunction", "unhash", "unlimit", "unsetopt", "vared", "whence",
  "where", "which", "zcompile", "zle", "zmodload", "zparseopts", "zstyle",
];

const FISH = [
  "abbr", "and", "argparse", "begin", "bind", "block", "breakpoint", "builtin", "case", "commandline",
  "complete", "contains", "count", "disown", "else", "emit", "end", "function", "functions", "history",
  "math", "not", "or", "random", "realpath", "set_color", "status", "string", "switch",
];

const RESERVED: Record<Shell, Set<string>> = {
  bash: new Set([...POSIX, ...BASH]),
  zsh: new Set([...POSIX, ...ZSH]),
  fish: new Set([...POSIX, ...FISH]),
};

/** Builtins and keywords a proposed name must not shadow. */
export function isReserved(shell: Shell, name: string): boolean {
  return RESERVED[shell].has(name);
}
