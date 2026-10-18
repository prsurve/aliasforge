import type { Pattern } from "../types.js";

const R = String.raw;

export const kubectl: Pattern[] = [
  {
    id: "kubectl/delete-all",
    category: "danger",
    severity: "high",
    title: "kubectl delete --all",
    advice: "Check the namespace and context first (kubectl config current-context), and use --dry-run=client.",
    pattern: R`\bkubectl\s+delete\b[^;&|]*\s(?:--all|--all-namespaces|-A)(?=\s|$)`,
  },
  {
    id: "kubectl/delete-namespace",
    category: "danger",
    severity: "medium",
    title: "kubectl delete namespace",
    advice: "Deleting a namespace removes everything inside it. Confirm the context first.",
    pattern: R`\bkubectl\s+delete\s+(?:ns|namespaces?)\b`,
  },
  {
    id: "kubectl/secret-literal",
    category: "secret",
    severity: "high",
    title: "Secret value typed with --from-literal",
    advice: "Rotate the value. Create secrets from a file or a secret manager.",
    pattern: R`--from-literal[=\s]+["']?[^\s=]+=(?<secret>[^\s"']+)`,
  },
  {
    id: "kubectl/token-flag",
    category: "secret",
    severity: "high",
    title: "Token passed to kubectl",
    advice: "Revoke the token and use a kubeconfig user entry instead.",
    pattern: R`\bkubectl\b[^;&|]*\s--token(?:=|\s+)["']?(?<secret>[^\s"'$-][^\s"']*)`,
  },
];
