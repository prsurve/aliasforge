# AliasForge

Reads your shell history **locally** and suggests aliases and functions for the commands you repeat most. It also flags risky habits (`chmod -R 777`, `rm -rf $VAR`) and secrets typed into commands.

Offline by design. No network calls, no telemetry, and it never runs a command from your history.

> Status: pre-release (not on npm yet). `suggest`, `risks`, `apply` and `stats` work.

## Install

The npm package is named `shell-aliasforge`; the command it installs is `aliasforge`. It is not published yet, so for now build from a clone (Node 24 or newer):

```sh
git clone https://github.com/prsurve/aliasforge.git
cd aliasforge
npm ci
npm run build
node dist/cli.js --help
```

After the first release:

```sh
npm install -g shell-aliasforge
aliasforge suggest

# or without installing
npx shell-aliasforge suggest
```

The examples below use the `aliasforge` command.

## Commands

### `aliasforge suggest`

Ranks the aliases that would save the most keystrokes, with ready-to-paste definitions.

```sh
aliasforge suggest [--shell bash|zsh|fish] [--file <path>] [--min-count N] [--min-length N] [--top N] [--json]
```

Example, on a synthetic history file (`test/fixtures/suggest_history`):

```text
$ aliasforge suggest --file test/fixtures/suggest_history --shell zsh
#  Score  Count  Pattern                                 Names
1  114    6      kubectl get pods -n prod                kgpnp, kgpp, kugpp
2  108    12     git checkout <arg>                      gco, gc, gic
3  102    6      docker exec -it <arg> bash  (function)  deib, deb, doeb
4  96     12     git status                              gs, gst, gis

Copy-paste for zsh:

# aliasforge suggestions
alias kgpnp='kubectl get pods -n prod'
alias gco='git checkout'
deib() { docker exec -it "$1" bash; }
alias gs='git status'
```

How it works:

- Commands are normalized (whitespace collapsed, trailing `\` removed) and also split on `&&`, `||`, `|` and `;`, so pieces of pipelines count too.
- Identical commands group together. Commands that differ only in one argument group into a template: `git checkout <arg>`.
- **Score** = occurrences x (typed length - alias name length). Defaults: at least 5 uses (`--min-count`) and 8 characters (`--min-length`).
- A template whose last argument varies becomes an **alias** (extra words pass through). One whose argument sits in the middle becomes a **function**.
- Names come from known conventions (`gs`, `k`) and initials, and skip anything that would shadow a builtin, a program on your `PATH`, or an alias or function in your rc files. The name list shows up to three options.
- Which names are free depends on the machine running the command, so results can differ between computers.

### `aliasforge risks`

Flags dangerous commands and secrets.

```sh
aliasforge risks [--shell bash|zsh|fish] [--file <path>] [--json]
```

Example, on a synthetic history with a fake token:

```text
$ aliasforge risks --file risky_history
5 finding(s) in 5 history entries (2 secret, 3 dangerous).

[HIGH] GitHub token
  entry #2 on 2023-11-14
  export GITHUB_TOKEN=ghp_****
  -> Revoke the token at github.com/settings/tokens and remove this entry from your history.

[HIGH] Force push to main or master
  entry #3
  git push --force origin main
  -> Rewriting a shared branch can lose teammates' commits. Use a feature branch or --force-with-lease on a topic branch.

[HIGH] curl --user with a password
  entry #4
  curl -u admin:hun**** https://example.com/api | sh
  -> Rotate the password. Use a ~/.netrc file or a token from an env var.

[HIGH] Download piped straight into a shell
  entry #4
  curl -u admin:hun**** https://example.com/api | sh
  -> Download the script, read it, then run it.

[HIGH] Recursive forced delete of an unquoted variable
  entry #5
  rm -rf $BUILD_DIR/out
  -> If the variable is empty or contains spaces this deletes the wrong thing. Quote it ("$DIR") and use ${DIR:?}.

Rotate every credential listed above, then remove those entries from your history file. aliasforge never edits it.
```

- A full secret is never printed. Previews mask every detected secret: up to the first 4 characters, then `****`. Short secrets show fewer characters (a quarter of their length).
- Rules live in pattern packs: `core`, `git`, `docker`, `kubectl`, `systemd`, `cloud`. See [CONTRIBUTING.md](CONTRIBUTING.md) to add one.
- Detection is pattern based. A secret with no recognizable shape, such as a bare password after a custom command, will not be caught.
- Entry numbers count parsed commands in order. They are not line numbers in the history file.

### `aliasforge apply`

Writes chosen aliases into your shell's rc file, between markers, after making a backup.

```sh
aliasforge apply --shell bash|zsh|fish [--select 1,3,gs] [--dry-run] [--file <path>] [--min-count N] [--min-length N] [--top N]
```

```text
$ aliasforge apply --shell zsh --file test/fixtures/suggest_history --top 2 --dry-run
Target: /home/you/.zshrc
Added: kgpnp, gco

--- /home/you/.zshrc
+++ /home/you/.zshrc
@@ -1,1 +1,7 @@
 export EDITOR=vim
+
+# >>> aliasforge >>>
+# Managed by aliasforge. `aliasforge apply` edits only this block.
+alias kgpnp='kubectl get pods -n prod'
+alias gco='git checkout'
+# <<< aliasforge <<<

Dry run: nothing was written.
```

- `--shell` is required because it decides which file is edited: `~/.bashrc`, `${ZDOTDIR:-~}/.zshrc` or `~/.config/fish/config.fish`.
- `--select` takes ranks from `suggest` and/or proposed names. Leave it out to apply every suggestion. The `--top`, `--min-count` and `--min-length` values should match the `suggest` run you looked at, since ranks depend on them.
- Only the text between `# >>> aliasforge >>>` and `# <<< aliasforge <<<` is touched.
- Before any change the file is copied to `<rc>.aliasforge-backup-<UTC timestamp>`. Backups are never overwritten.
- Definitions already in the block are kept, so applying again adds to it. If a name clashes with a different definition in the block, the next proposed name is used, or the suggestion is skipped.
- Running it twice changes nothing: if the result would match the file, nothing is written and no backup is made.
- A damaged block (missing, duplicate or reversed markers) stops the command and changes nothing.
- Remove the block by hand to uninstall.

### `aliasforge stats`

History size, most-used programs and the time span.

```sh
aliasforge stats [--shell bash|zsh|fish] [--file <path>] [--top N] [--json]
```

```text
$ aliasforge stats --file history.txt --top 3
Shell: bash
Entries: 4 (4 unique)
Time span: 2023-11-14 to 2024-01-11 (57 days, 3 entries with a time)

Top commands:
   1  git   2
   2  apt   1
   3  grep  1
```

- Programs are counted per sub-command, so both sides of a pipeline count. `VAR=x`, `sudo`, `time` and similar prefixes are skipped to find the real program.
- The time span needs timestamps. Plain bash history has none unless `HISTTIMEFORMAT` was set.
- Ties are listed alphabetically.

## `--json` output

All JSON is printed to stdout. New fields may be added in later versions; existing ones keep their meaning.

### `suggest --json`

```json
{
  "shell": "zsh",
  "historyEntries": 39,
  "suggestions": [
    {
      "rank": 2,
      "kind": "alias",
      "pattern": "git checkout <arg>",
      "command": "git checkout",
      "count": 12,
      "score": 108,
      "names": ["gco", "gc", "gic"],
      "definition": "alias gco='git checkout'"
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `shell` | `"bash" \| "zsh" \| "fish"` | Dialect used for `definition`, and how the history was parsed |
| `historyEntries` | number | Commands parsed from the history file |
| `suggestions[].rank` | number | 1-based position, best first |
| `suggestions[].kind` | `"alias" \| "function"` | What `definition` defines |
| `suggestions[].pattern` | string | What is being replaced. `<arg>` marks the part that varies |
| `suggestions[].command` | string | The alias body. For a function, the body with `<arg>` where the argument goes |
| `suggestions[].count` | number | How often the pattern occurs |
| `suggestions[].score` | number | `count x (typed length - name length)`, using the first name |
| `suggestions[].names` | string[] | Up to three free names. The first is used in `definition` |
| `suggestions[].definition` | string | Ready to paste. May contain newlines (fish functions) |

### `risks --json`

```json
{
  "shell": "bash",
  "historyEntries": 5,
  "findings": [
    {
      "id": "git/github-token",
      "category": "secret",
      "severity": "high",
      "title": "GitHub token",
      "advice": "Revoke the token at github.com/settings/tokens and remove this entry from your history.",
      "entry": 2,
      "preview": "export GITHUB_TOKEN=ghp_****",
      "date": "2023-11-14"
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `shell`, `historyEntries` | | As above |
| `findings[].id` | string | Rule id, `<pack>/<name>` |
| `findings[].category` | `"danger" \| "secret"` | |
| `findings[].severity` | `"high" \| "medium" \| "low"` | Findings are sorted high first, then by `entry` |
| `findings[].title`, `advice` | string | Human-readable |
| `findings[].entry` | number | 1-based position of the command in the parsed history |
| `findings[].preview` | string | The command with secrets masked, cut to 100 characters |
| `findings[].date` | string, optional | `YYYY-MM-DD` (UTC), present only if the history file recorded a time |

### `stats --json`

```json
{
  "shell": "bash",
  "historyEntries": 4,
  "uniqueCommands": 4,
  "timestampedEntries": 3,
  "firstDate": "2023-11-14",
  "lastDate": "2024-01-11",
  "spanDays": 57,
  "topCommands": [{ "command": "git", "count": 2 }]
}
```

`firstDate`, `lastDate` and `spanDays` are left out when the history has no timestamps. `uniqueCommands` counts distinct commands after whitespace is collapsed.

## History files

By default AliasForge reads `~/.bash_history`, `~/.zsh_history` or `~/.local/share/fish/fish_history`, based on `--shell` or `$SHELL`. Point it at any file with `--file`; the shell is guessed from the file name and content unless you pass `--shell`.

- **bash:** one command per line. `#1700000000` timestamp lines (from `HISTTIMEFORMAT`) are used for dates.
- **zsh:** plain or extended (`: 1700000000:0;command`) lines, backslash continuations, and zsh's escaped ("metafied") bytes.
- **fish:** `- cmd:` / `when:` entries.
- Malformed lines, CRLF, a BOM, blank lines and very large files are handled.
- The working directory is not recorded in history, so there are no per-directory suggestions.

## Privacy and safety

- No network access. A test fails if the source imports `fetch`, `http` or similar.
- Commands from history are only read as text. They are never executed.
- `suggest` and `risks` are read-only. `apply` is the only command that writes, and only inside its marked block, after a backup.
- Alias bodies are single-quoted when written. A function is offered only if its body has balanced quotes and brackets and nothing that could break out of it, because that text is pasted into your rc file.
- Collision checks read the directories on your `PATH` and your rc files. They never start a shell.

## Not the same as

- Alias managers (store aliases you write yourself): AliasForge *discovers* them from what you actually type.
- The unrelated OSINT repo also named "Aliasforge": no connection.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The full spec and build plan is in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE)
