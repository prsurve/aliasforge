import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeStats, programOf, renderStats } from "../src/analyze/stats.js";
import { type Io, run } from "../src/cli.js";

describe("programOf", () => {
  it("finds the program behind wrappers and assignments", () => {
    expect(programOf("git status")).toBe("git");
    expect(programOf("FOO=1 BAR=2 make test")).toBe("make");
    expect(programOf("sudo -E systemctl restart x")).toBe("systemctl");
    expect(programOf("time nohup ./run.sh")).toBe("run.sh");
    expect(programOf("/usr/bin/python3 app.py")).toBe("python3");
    expect(programOf("do echo hi")).toBe("echo");
  });

  it("skips the value of wrapper options", () => {
    expect(programOf("sudo -u root ls")).toBe("ls");
    expect(programOf("sudo -Eu root systemctl restart x")).toBe("systemctl");
    expect(programOf("sudo -uroot ls")).toBe("ls");
    expect(programOf("sudo --user=root ls")).toBe("ls");
    expect(programOf("sudo --user root ls")).toBe("ls");
    expect(programOf("sudo -n -E ls")).toBe("ls");
    expect(programOf("sudo -- ls -la")).toBe("ls");
    expect(programOf("sudo -u root -g wheel id")).toBe("id");
    expect(programOf("doas -u www ls")).toBe("ls");
    expect(programOf("env -u FOO -i PATH=/x make")).toBe("make");
    expect(programOf("nice -n 5 make -j4")).toBe("make");
    expect(programOf("time -p make")).toBe("make");
    expect(programOf("time -f %e make")).toBe("make");
    expect(programOf("nohup sudo -u app ./run.sh")).toBe("run.sh");
    expect(programOf("env - ls")).toBe("ls");
  });

  it("returns nothing for empty or comment units", () => {
    expect(programOf("")).toBeUndefined();
    expect(programOf("# note")).toBeUndefined();
    expect(programOf("FOO=1")).toBeUndefined();
    expect(programOf("sudo")).toBeUndefined();
    expect(programOf("sudo -u root")).toBeUndefined();
  });
});

describe("computeStats", () => {
  const day = 86_400;
  const base = 1_700_000_000;

  it("counts entries, unique commands, programs and the time span", () => {
    const stats = computeStats(
      [
        { command: "git status", timestamp: base },
        { command: "git  status", timestamp: base + 10 * day },
        { command: "ls | grep x && git pull", timestamp: base + 3 * day },
        { command: "" },
      ],
      2,
    );
    expect(stats).toEqual({
      historyEntries: 4,
      uniqueCommands: 2,
      timestampedEntries: 3,
      firstDate: "2023-11-14",
      lastDate: "2023-11-24",
      spanDays: 10,
      topCommands: [
        { command: "git", count: 3 },
        { command: "grep", count: 1 },
      ],
    });
  });

  it("omits the time span when there are no timestamps", () => {
    const stats = computeStats([{ command: "ls" }, { command: "ls", timestamp: Number.NaN }], 5);
    expect(stats.firstDate).toBeUndefined();
    expect(stats.spanDays).toBeUndefined();
    expect(stats.timestampedEntries).toBe(0);
    expect(renderStats("bash", stats)).toContain("Time span: unknown");
  });

  it("handles empty history", () => {
    expect(computeStats([], 10)).toEqual({ historyEntries: 0, uniqueCommands: 0, timestampedEntries: 0, topCommands: [] });
    expect(renderStats("zsh", computeStats([], 10))).toBe("Shell: zsh\nEntries: 0 (0 unique)\nTime span: unknown (this history has no timestamps)");
  });

  it("breaks ties alphabetically", () => {
    const stats = computeStats([{ command: "b" }, { command: "a" }], 10);
    expect(stats.topCommands.map((c) => c.command)).toEqual(["a", "b"]);
  });
});

describe("stats command", () => {
  function setup(content: string): { file: string; io: Io; out: string[] } {
    const dir = mkdtempSync(join(tmpdir(), "af-stats-"));
    const file = join(dir, ".bash_history");
    writeFileSync(file, content);
    const out: string[] = [];
    return { file, out, io: { out: (t) => out.push(t), err: () => {}, home: dir, env: { PATH: "" } } };
  }

  it("prints a readable summary", () => {
    const { file, io, out } = setup("#1700000000\ngit status\n#1700086400\ngit pull\nls\n");
    expect(run(["stats", "--file", file], io)).toBe(0);
    expect(out[0]).toBe(
      [
        "Shell: bash",
        "Entries: 3 (3 unique)",
        "Time span: 2023-11-14 to 2023-11-15 (1 days, 2 entries with a time)",
        "",
        "Top commands:",
        "   1  git  2",
        "   2  ls   1",
      ].join("\n"),
    );
  });

  it("emits JSON and honours --top", () => {
    const { file, io, out } = setup("git status\ngit pull\nls\n");
    expect(run(["stats", "--file", file, "--json", "--top", "1"], io)).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({
      shell: "bash",
      historyEntries: 3,
      uniqueCommands: 3,
      timestampedEntries: 0,
      topCommands: [{ command: "git", count: 2 }],
    });
  });

  it("rejects a bad --top", () => {
    const { file, io } = setup("ls\n");
    expect(run(["stats", "--file", file, "--top", "x"], io)).toBe(2);
  });
});
