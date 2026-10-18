import type { Pack } from "../types.js";
import { cloud } from "./cloud.js";
import { core } from "./core.js";
import { docker } from "./docker.js";
import { git } from "./git.js";
import { kubectl } from "./kubectl.js";
import { systemd } from "./systemd.js";

/**
 * All packs. Specific packs come before `core` so that when two rules match
 * the same secret, the more specific title wins.
 */
export const packs: Pack[] = [
  { name: "cloud", patterns: cloud },
  { name: "git", patterns: git },
  { name: "docker", patterns: docker },
  { name: "kubectl", patterns: kubectl },
  { name: "systemd", patterns: systemd },
  { name: "core", patterns: core },
];
