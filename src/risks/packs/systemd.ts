import type { Pattern } from "../types.js";

const R = String.raw;

export const systemd: Pattern[] = [
  {
    id: "systemd/stop-remote-access",
    category: "danger",
    severity: "high",
    title: "Stopping SSH or networking services",
    advice: "On a remote machine this can lock you out. Keep a second session open.",
    pattern: R`\bsystemctl\s+(?:--\S+\s+)*(?:stop|disable|mask)\s+(?:--\S+\s+)*(?:sshd?|networking|NetworkManager|systemd-networkd)(?:\.service)?(?=\s|$)`,
  },
  {
    id: "systemd/isolate-rescue",
    category: "danger",
    severity: "medium",
    title: "systemctl isolate to a minimal or power target",
    advice: "This stops most services at once. Make sure you have console access.",
    pattern: R`\bsystemctl\s+isolate\s+(?:rescue|emergency|poweroff|halt)(?:\.target)?(?=\s|$)`,
  },
];
