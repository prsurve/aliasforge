# AliasForge

Local-first CLI that mines shell history to suggest aliases/functions and flag risky or secret-leaking commands. Free, open source, offline.

## Goals
1. Show the aliases that would save the most keystrokes, ranked, with ready-to-paste definitions.
2. Warn about dangerous patterns and accidentally typed secrets.
3. Never send data anywhere. No network calls, no telemetry. Ever.

## Non-goals
- Not an alias manager for aliases the user writes by hand.
- No cloud sync, accounts, or AI/LLM calls in v1 (an optional local-LLM step may come later).
- Does not edit rc files without an explicit `apply` and a backup.

## Stack
TypeScript on Node 24, **zero runtime dependencies** (dev deps: typescript, vitest, tsx). ESM. Built with `tsc`, published as an npm package with a `bin` entry. Keep the install tiny.

## Commands (v1)
- `aliasforge suggest [--shell bash|zsh|fish] [--min-count N] [--top N] [--json]`
- `aliasforge risks [--json]`
- `aliasforge apply --shell <sh> [--select ...]` writes a managed block (`# >>> aliasforge >>>` ... `# <<< aliasforge <<<`) to the rc file, after making a timestamped backup, with a `--dry-run` that prints a diff.
- `aliasforge stats` (history size, top commands, time span)

## History formats (parse defensively; lines can be malformed or multi-line)
- **bash** `~/.bash_history`: one command per line; if `HISTTIMEFORMAT` was set, lines like `#1700000000` precede commands.
- **zsh** `~/.zsh_history`: plain lines, or extended format `: 1700000000:0;command`. Multi-line commands end lines with a trailing backslash. Zsh escapes some bytes (metafied); handle it.
- **fish** `~/.local/share/fish/fish_history`: YAML-like entries `- cmd: ...` then `  when: 1700000000`.
- Working directory is generally NOT recorded; do not promise per-directory suggestions.
- Allow `--file <path>` to point at any history file (used heavily in tests).

## Suggestion engine
1. Normalize: trim, collapse whitespace, strip trailing `\`. Keep full command lines and also split on `&&`, `|`, `;` for sub-command stats.
2. Group identical commands and *near-identical* ones (same program + flags, differing only in the last argument) into templates, e.g. `git checkout <branch>`.
3. Score = occurrences x (length of command - length of proposed alias). Require min count (default 5) and min length (default 8 chars).
4. Name proposals: derive from initials/known conventions (`gs` for `git status`, `k` for `kubectl`), avoid collisions with existing commands (`command -v`), existing aliases/functions, and shell builtins/keywords. Offer 2-3 name options.
5. Use a **function** instead of an alias when the template has a variable argument in the middle.
6. Output: ranked table plus copy-paste block per shell dialect.

## Risk and secret detection (`risks`)
Pattern packs as plain data (JSON/TS arrays), one file per area so contributors can add packs easily: `core`, `git`, `docker`, `kubectl`, `systemd`, `cloud`.
- Dangerous: `chmod -R 777`, `rm -rf` with an unquoted variable or `/`, `curl ... | sh` / `| sudo bash`, `dd of=/dev/...`, `sudo` + redirect, `git push --force` to main/master, `kubectl delete ... --all`, `docker run --privileged`.
- Secrets: AWS keys (`AKIA...`), GitHub tokens (`ghp_`, `gho_`, `github_pat_`), `Authorization: Bearer ...`, `--password=`/`-p<pw>` flags, `export *_TOKEN=...`, private-key headers, basic-auth URLs.
- **Never print a full secret.** Show command index, date if known, and a masked preview (first 4 chars + `****`). Advise rotating the credential and removing the history line.

## Safety rules
- Read-only by default. Only `apply` writes, only inside the managed block, always with a backup.
- Never execute any command found in history.
- No network access in code or tests. A test should fail if `fetch`/`http` is imported.

## Repo layout (proposed)
```
src/
  cli.ts            argument parsing and command dispatch
  history/          bash.ts zsh.ts fish.ts detect.ts
  analyze/          normalize.ts templates.ts score.ts naming.ts
  risks/            engine.ts packs/*.ts mask.ts
  apply/            block.ts backup.ts
test/
  fixtures/         sample history files per shell (synthetic, no real data)
  *.test.ts
```

## Milestones
1. Scaffold: package.json, tsconfig, vitest, CI (GitHub Actions: typecheck + tests on Node 24), lint-free build.
2. History parsers for bash/zsh/fish with fixtures and edge cases (multi-line, malformed, empty, huge file, CRLF).
3. `suggest` with templating, scoring, naming and collision checks.
4. `risks` with the first pattern packs and masking tests.
5. `apply` with managed block, backup, dry-run, idempotency tests (running twice changes nothing).
6. README with real example output, `--json` schema docs, CONTRIBUTING (how to add a pattern pack).
7. Publish to npm and tag v0.1.0.

## Testing rules
- Every parser gets fixture-driven tests, including nasty inputs. Fixtures are synthetic; never commit a real history file.
- Secret-detection tests use obviously fake tokens that match the shape only.
- `apply` tests run against a temp HOME, never the real one.

## Working conventions
- Branch per change (`feat/...`, `fix/...`), open a PR, do not merge it yourself. No direct commits to `main` after the initial scaffold.
- Keep dependencies at zero unless there is a strong reason; ask first.
- Match the code style already in the repo; short functions, no clever tricks.

## Open decisions for the owner
- License (MIT vs Apache-2.0). Not chosen yet, so no LICENSE file.
- Public or private GitHub repo, and the final repo name (an unrelated OSINT repo called "Aliasforge" already exists on GitHub; collisions with `gitstq/AliasForge` and `codefitz/AliasForge`, which are hand-managed alias tools).
- npm package name availability (`aliasforge` may be taken; check before publishing).
