import { copyFileSync, constants } from "node:fs";

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
}

/** Copy `path` to `<path>.aliasforge-backup-<UTC timestamp>`. Never overwrites a backup. */
export function createBackup(path: string, now: Date): string {
  const base = `${path}.aliasforge-backup-${stamp(now)}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const target = attempt === 0 ? base : `${base}-${attempt}`;
    try {
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not create a backup next to ${path}`);
}
