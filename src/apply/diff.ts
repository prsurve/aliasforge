const CONTEXT = 3;

function split(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Unified diff of two texts that differ in one contiguous region, which is
 * all `apply` produces (the managed block). Empty string when equal.
 */
export function unifiedDiff(path: string, before: string, after: string): string {
  const a = split(before);
  const b = split(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix++;
  }
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  if (removed.length === 0 && added.length === 0) return before === after ? "" : `--- ${path}\n+++ ${path}\n(line endings or final newline changed)`;

  const from = Math.max(0, prefix - CONTEXT);
  const before3 = a.slice(from, prefix);
  const after3 = a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + CONTEXT));
  const oldCount = before3.length + removed.length + after3.length;
  const newCount = before3.length + added.length + after3.length;
  const header = `@@ -${oldCount === 0 ? from : from + 1},${oldCount} +${newCount === 0 ? from : from + 1},${newCount} @@`;
  return [
    `--- ${before === "" ? "/dev/null" : path}`,
    `+++ ${path}`,
    header,
    ...before3.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...after3.map((line) => ` ${line}`),
  ].join("\n");
}
