# AliasForge

Reads your shell history **locally** and suggests aliases, functions and small scripts for the commands you repeat most. It also flags risky habits (`chmod 777`, `rm -rf $VAR`) and secrets typed into commands.

Offline by default. Your history never leaves the machine.

> Status: just started. See `CLAUDE.md` for the full spec and build plan.

## Planned usage

```sh
aliasforge suggest            # top alias candidates from your history
aliasforge risks              # dangerous patterns and leaked secrets
aliasforge apply --shell zsh  # write chosen aliases to a managed block in your rc file
```

## Not the same as

- Alias managers (store aliases you write yourself): AliasForge *discovers* them from what you actually type.
- The unrelated OSINT repo also named "Aliasforge": no connection.
