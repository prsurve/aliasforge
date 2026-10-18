import type { Pattern } from "../types.js";

const R = String.raw;

export const git: Pattern[] = [
  {
    id: "git/force-push-main",
    category: "danger",
    severity: "high",
    title: "Force push to main or master",
    advice: "Rewriting a shared branch can lose teammates' commits. Use a feature branch or --force-with-lease on a topic branch.",
    pattern: R`\bgit\s+push\b(?=[^;&|]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force(?:-with-lease)?)(?:=\S+)?(?=\s|$))[^;&|]*\s\+?(?:\S*:)?(?:main|master)(?=\s|$)`,
  },
  {
    id: "git/force-push-main-refspec",
    category: "danger",
    severity: "high",
    title: "Force push to main or master (+refspec)",
    advice: "A leading + forces the push. Avoid force-pushing shared branches.",
    pattern: R`\bgit\s+push\b[^;&|]*\s\+(?:\S*:)?(?:main|master)(?=\s|$)`,
  },
  {
    id: "git/github-token",
    category: "secret",
    severity: "high",
    title: "GitHub token",
    advice: "Revoke the token at github.com/settings/tokens and remove this entry from your history.",
    pattern: R`\b(?<secret>(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})`,
  },
];
