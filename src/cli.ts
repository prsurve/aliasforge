#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = "0.0.0";

const HELP = `aliasforge ${VERSION}

Usage: aliasforge <command> [options]

Commands (not implemented yet):
  suggest   Suggest aliases from shell history
  risks     Flag dangerous commands and leaked secrets
  apply     Write chosen aliases to a managed block in your rc file
  stats     Show history size, top commands and time span
`;

export function run(args: string[]): number {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return 0;
  }
  console.log(HELP);
  return args.length === 0 || args.includes("--help") || args.includes("-h") ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
