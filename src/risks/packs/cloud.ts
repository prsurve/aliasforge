import type { Pattern } from "../types.js";

const R = String.raw;

export const cloud: Pattern[] = [
  {
    id: "cloud/aws-access-key-id",
    category: "secret",
    severity: "high",
    title: "AWS access key ID",
    advice: "Deactivate the key in IAM, create a new one and remove this entry from your history.",
    pattern: R`\b(?<secret>(?:AKIA|ASIA)[A-Z0-9]{16})\b`,
  },
  {
    id: "cloud/aws-secret-assignment",
    category: "secret",
    severity: "high",
    title: "AWS secret or session token",
    advice: "Rotate the credential in IAM and remove this entry from your history.",
    pattern: R`\bAWS_(?:SECRET_ACCESS_KEY|SESSION_TOKEN)=["']?(?<secret>[^\s"'$][^\s"']*)`,
  },
  {
    id: "cloud/aws-configure-set",
    category: "secret",
    severity: "high",
    title: "AWS credential set through aws configure",
    advice: "Rotate the credential in IAM and remove this entry from your history.",
    pattern: R`\baws\s+configure\s+set\s+\w*(?:secret_access_key|session_token)\s+["']?(?<secret>[^\s"']+)`,
    flags: "i",
  },
  {
    id: "cloud/google-api-key",
    category: "secret",
    severity: "high",
    title: "Google API key",
    advice: "Delete or restrict the key in the Cloud console and remove this entry from your history.",
    pattern: R`\b(?<secret>AIza[0-9A-Za-z_-]{35})`,
  },
  {
    id: "cloud/s3-recursive-delete",
    category: "danger",
    severity: "medium",
    title: "aws s3 rm --recursive or rb --force",
    advice: "Run with --dryrun first and check the bucket and prefix.",
    pattern: R`\baws\s+s3\s+(?:rm\b[^;&|]*\s--recursive|rb\b[^;&|]*\s--force)(?=\s|$)`,
  },
  {
    id: "cloud/terraform-auto-destroy",
    category: "danger",
    severity: "high",
    title: "terraform destroy without confirmation",
    advice: "Review the plan (terraform plan -destroy) and confirm the workspace first.",
    pattern: R`\bterraform\s+destroy\b[^;&|]*\s-auto-approve(?=\s|$)`,
  },
  {
    id: "cloud/gcloud-project-delete",
    category: "danger",
    severity: "high",
    title: "gcloud projects delete",
    advice: "Deleting a project removes all its resources. Confirm the project ID.",
    pattern: R`\bgcloud\s+projects\s+delete\b`,
  },
];
