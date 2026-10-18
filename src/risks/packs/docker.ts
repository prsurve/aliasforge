import type { Pattern } from "../types.js";

const R = String.raw;

export const docker: Pattern[] = [
  {
    id: "docker/run-privileged",
    category: "danger",
    severity: "high",
    title: "docker run --privileged",
    advice: "A privileged container can take over the host. Add only the capabilities you need (--cap-add).",
    pattern: R`\bdocker\s+(?:container\s+)?run\b[^;&|]*\s--privileged(?:=true)?(?=\s|$)`,
  },
  {
    id: "docker/mount-socket",
    category: "danger",
    severity: "medium",
    title: "Docker socket mounted into a container",
    advice: "Anything in the container can control the host's Docker. Avoid it unless required.",
    pattern: R`\bdocker\s+(?:container\s+)?run\b[^;&|]*\s(?:-v|--volume)[=\s]+\/var\/run\/docker\.sock`,
  },
  {
    id: "docker/login-password",
    category: "secret",
    severity: "high",
    title: "docker login with a password flag",
    advice: "Rotate the password. Use --password-stdin instead.",
    pattern: R`\bdocker\s+login\b[^;&|]*\s(?:-p|--password)[=\s]+["']?(?<secret>[^\s"'$-][^\s"']*)`,
  },
];
