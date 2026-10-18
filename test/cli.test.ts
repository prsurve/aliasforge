import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Io, run } from "../src/cli.js";

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), home: "/nonexistent-home", env: { PATH: "" } };
  return { io, out, err };
}

const fixture = join(import.meta.dirname, "fixtures", "suggest_history");

describe("cli", () => {
  it("prints the version", () => {
    const { io, out } = capture();
    expect(run(["--version"], io)).toBe(0);
    const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string };
    expect(out).toEqual([version]);
  });

  it("suggest --json emits the documented shape", () => {
    const { io, out } = capture();
    expect(run(["suggest", "--file", fixture, "--shell", "bash", "--json"], io)).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.shell).toBe("bash");
    expect(report.historyEntries).toBe(39);
    const patterns = report.suggestions.map((s: { pattern: string }) => s.pattern);
    expect(patterns).toEqual(
      expect.arrayContaining(["git status", "git checkout <arg>", "docker exec -it <arg> bash", "kubectl get pods -n prod"]),
    );
    expect(report.suggestions[0]).toHaveProperty("definition");
  });

  it("suggest prints a table and a copy-paste block", () => {
    const { io, out } = capture();
    expect(run(["suggest", "--file", fixture, "--shell", "zsh", "--top", "2"], io)).toBe(0);
    expect(out[0]).toContain("Pattern");
    expect(out[0]).toContain("Copy-paste for zsh:");
    expect(out[0]).toContain("alias ");
  });

  it("rejects bad options with exit code 2", () => {
    for (const args of [["suggest", "--top", "0"], ["suggest", "--shell", "csh"], ["suggest", "--nope"], ["bogus"]]) {
      const { io, err } = capture();
      expect(run(args, io)).toBe(2);
      expect(err.length).toBeGreaterThan(0);
    }
  });

  it("reports a missing history file", () => {
    const { io, err } = capture();
    expect(run(["suggest", "--file", "/no/such/file"], io)).toBe(1);
    expect(err[0]).toContain("ENOENT");
  });
});
