# Security policy

aliasforge reads your shell history locally. It makes no network calls and never runs a command from your history. A security problem here is most likely one of these:

- a secret from history shown, suggested or written to a file in full
- `aliasforge apply` writing outside its managed block, or without a backup
- a command from history being executed

## Reporting a problem

Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Please do not open a public issue with details.

Do not include real secrets or your real history in a report. A made-up history line that shows the problem is enough.

## Supported versions

Only the latest release gets fixes. This is a small project maintained by one person, so there is no fixed response time, but reports about secret exposure are handled first.
