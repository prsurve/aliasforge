# Contributing

AliasForge is local-first and tiny. Two rules shape every change:

1. **No network, ever.** No `fetch`, no `http`, no telemetry. A test enforces it.
2. **Zero runtime dependencies.** Dev dependencies are `typescript`, `vitest`, `tsx` and `@types/node`. Ask before adding anything else.

## Setup

Node 24 or newer.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev -- suggest --file test/fixtures/suggest_history
```

## Workflow

- One change per branch (`feat/...`, `fix/...`, `docs/...`), then open a pull request. Do not commit to `main`.
- Match the style around you: short functions, no clever tricks.
- Add tests with the change. Parsers need fixture-driven tests, including nasty input.

## Test data

- Fixtures in `test/fixtures/` are synthetic. Never commit a real history file.
- Secret tests use obviously fake tokens that match the shape only. Build them at runtime (`"ghp_" + "x".repeat(36)`) so no token-shaped string sits in the repo.
- `apply` tests run against a temporary HOME, never the real one.

## Adding a pattern pack

Rules for `aliasforge risks` are plain data in `src/risks/packs/`, one file per area: `core`, `git`, `docker`, `kubectl`, `systemd`, `cloud`.

### Add a rule to an existing pack

Add an object to the array in the pack file:

```ts
{
  id: "docker/run-privileged",       // "<pack>/<name>", unique
  category: "danger",                // "danger" or "secret"
  severity: "high",                  // "high" | "medium" | "low"
  title: "docker run --privileged",
  advice: "A privileged container can take over the host. Add only the capabilities you need (--cap-add).",
  pattern: String.raw`\bdocker\s+(?:container\s+)?run\b[^;&|]*\s--privileged(?:=true)?(?=\s|$)`,
  flags: "i",                        // optional
}
```

Guidelines for `pattern`:

- It is a JavaScript regular expression source. Use `String.raw` so backslashes stay readable.
- The command is matched after whitespace is collapsed to single spaces. A pattern sees one line.
- Keep matches inside one sub-command by using `[^;&|]*` instead of `.*`. This also keeps matching fast; avoid nested quantifiers.
- **Secret rules** must mark the secret itself with a named group: `(?<secret>...)`. Only that part is masked. Without the group the whole match is masked. Skip values that are variable references, e.g. start the value with `[^\s"'$-]`, so `--password $PW` is not flagged.
- **Danger rules** should name the exact risky form, not the whole tool. Prefer few false positives: a noisy rule trains people to ignore the report.
- `advice` says what to do instead. For secrets, say how to rotate or revoke.

### Add a new pack

1. Create `src/risks/packs/<name>.ts` exporting an array of `Pattern`s, with ids starting `<name>/`.
2. Register it in `src/risks/packs/index.ts`. Put specific packs before `core`: when two rules match the same secret, the earlier one names it.

### Test it

Every rule needs an entry in the `CASES` table in `test/risks.test.ts`:

```ts
["docker/run-privileged",
  ["docker run --privileged -it ubuntu"],        // must match
  ["docker run -it ubuntu"]],                    // must not match
```

The suite fails if a rule has no entry, if ids repeat, or if a pattern does not compile. Include near misses in the "must not match" list.

Also check that your secret rule never leaks: the "never puts a full secret in a finding" test shows how.

## Adding to `suggest`

- Known short names live in `CONVENTIONS` in `src/analyze/naming.ts`.
- Builtins and keywords per shell live in `src/analyze/reserved.ts`.

## CI

Besides typecheck, tests and build, CI has a `shells` job that runs once each for bash, zsh and fish. It installs the shell, runs the built CLI on that shell's fixture, then loads the generated rc block in the real shell: a syntax check, then calling one alias and one function with stubbed `git` and `docker`. To run one locally (the shell must be installed):

```sh
AF_E2E_SHELL=zsh AF_E2E_REQUIRE_SHELL=1 npx vitest run test/e2e.test.ts
```

Without `AF_E2E_REQUIRE_SHELL`, tests for a shell that is not installed are skipped.

## License

By contributing you agree that your work is released under the [MIT license](LICENSE).
