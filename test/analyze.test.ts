import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEnvironment, definedNames } from "../src/analyze/environment.js";
import { proposeNames } from "../src/analyze/naming.js";
import { normalizeCommand, splitSubcommands, tokenize } from "../src/analyze/normalize.js";
import { renderDefinition } from "../src/analyze/render.js";
import { suggest } from "../src/analyze/suggest.js";
import { buildCandidates, type Candidate } from "../src/analyze/templates.js";

const none = (): boolean => false;
const entries = (command: string, times: number) => Array.from({ length: times }, () => ({ command }));

describe("normalize", () => {
  it("trims, collapses whitespace and strips trailing backslashes", () => {
    expect(normalizeCommand("  git   status \\ ")).toBe("git status");
    expect(normalizeCommand("echo a\n  b")).toBe("echo a b");
    expect(normalizeCommand("   ")).toBe("");
  });

  it("splits sub-commands outside quotes only", () => {
    expect(splitSubcommands("a && b | c; d || e")).toEqual(["a", "b", "c", "d", "e"]);
    expect(splitSubcommands(`echo "a | b" && grep 'x;y'`)).toEqual([`echo "a | b"`, `grep 'x;y'`]);
    expect(splitSubcommands(String.raw`echo a\;b`)).toEqual([String.raw`echo a\;b`]);
  });

  it("tokenizes keeping quoted words together", () => {
    expect(tokenize(`git commit -m "fix: a b"`)).toEqual(["git", "commit", "-m", `"fix: a b"`]);
  });
});

describe("templates", () => {
  const find = (list: Candidate[], pattern: string) => list.find((c) => c.pattern === pattern);

  it("groups near-identical commands into a trailing template", () => {
    const candidates = buildCandidates([["git checkout main"], ["git checkout dev"], ["git checkout dev"]]);
    expect(find(candidates, "git checkout main")?.count).toBe(1);
    expect(find(candidates, "git checkout dev")?.count).toBe(2);
    expect(find(candidates, "git checkout <arg>")).toMatchObject({ shape: "trailing", count: 3, command: "git checkout" });
  });

  it("makes a middle-argument template for functions", () => {
    const candidates = buildCandidates([["docker exec -it web bash"], ["docker exec -it db bash"]]);
    expect(find(candidates, "docker exec -it <arg> bash")).toMatchObject({ shape: "middle", count: 2 });
  });

  it("does not template a single distinct argument", () => {
    const candidates = buildCandidates([["git checkout main"], ["git checkout main"]]);
    expect(find(candidates, "git checkout <arg>")).toBeUndefined();
  });
});

describe("naming", () => {
  const candidate = (command: string, shape: Candidate["shape"] = "exact"): Candidate => ({
    shape,
    command,
    pattern: command,
    count: 10,
    replacedLength: command.length,
  });

  it("prefers conventions, then initials", () => {
    expect(proposeNames(candidate("git status"), none)).toEqual(["gs", "gst", "gis"]);
    expect(proposeNames(candidate("terraform apply -auto-approve"), none)[0]).toBe("taa");
  });

  it("skips taken names and falls back to a suffix", () => {
    expect(proposeNames(candidate("git status"), (n) => n === "gs")).toEqual(["gst", "gis"]);
    const allTaken = (n: string) => !/\d$/.test(n);
    expect(proposeNames(candidate("git status"), allTaken)).toEqual(["gs2"]);
  });

  it("only offers valid function identifiers for functions", () => {
    const names = proposeNames(candidate("docker exec -it <arg> bash", "middle"), none);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^[A-Za-z_]\w*$/);
  });
});

describe("environment", () => {
  it("detects builtins, PATH commands and rc definitions", () => {
    const home = mkdtempSync(join(tmpdir(), "af-home-"));
    const bin = mkdtempSync(join(tmpdir(), "af-bin-"));
    writeFileSync(join(bin, "mytool"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(bin, "notexec"), "x", { mode: 0o644 });
    writeFileSync(join(home, ".zshrc"), "alias gx='git x'\nmyfn() { :; }\nfunction other { :; }\n");

    const isTaken = createEnvironment({ shell: "zsh", home, path: bin });
    expect(isTaken("cd")).toBe(true);
    expect(isTaken("mytool")).toBe(true);
    expect(isTaken("notexec")).toBe(false);
    expect(isTaken("gx")).toBe(true);
    expect(isTaken("myfn")).toBe(true);
    expect(isTaken("other")).toBe(true);
    expect(isTaken("freename")).toBe(false);
  });

  it("reads fish functions and abbreviations", () => {
    const home = mkdtempSync(join(tmpdir(), "af-fish-"));
    mkdirSync(join(home, ".config/fish/functions"), { recursive: true });
    writeFileSync(join(home, ".config/fish/functions/fz.fish"), "function fz\nend\n");
    writeFileSync(join(home, ".config/fish/config.fish"), "abbr -a gg 'git grep'\nalias ll 'ls -l'\n");
    const isTaken = createEnvironment({ shell: "fish", home, path: "" });
    expect([isTaken("fz"), isTaken("gg"), isTaken("ll"), isTaken("zz")]).toEqual([true, true, true, false]);
  });

  it("extracts defined names from rc text", () => {
    expect([...definedNames("alias -g L='| less'\n  alias a=b\n")]).toEqual(["L", "a"]);
  });
});

describe("render", () => {
  it("quotes aliases per dialect", () => {
    const item = { kind: "alias", name: "x", command: "echo 'hi'" } as const;
    expect(renderDefinition("bash", item)).toBe(`alias x='echo '\\''hi'\\'''`);
    expect(renderDefinition("fish", item)).toBe(`alias x 'echo \\'hi\\''`);
  });

  it("renders functions per dialect", () => {
    const item = { kind: "function", name: "dx", command: "docker exec -it <arg> bash" } as const;
    expect(renderDefinition("zsh", item)).toBe('dx() { docker exec -it "$1" bash; }');
    expect(renderDefinition("fish", item)).toBe("function dx\n    docker exec -it $argv[1] bash\nend");
  });
});

describe("suggest", () => {
  const options = { shell: "bash", minCount: 5, minLength: 8, top: 10 } as const;

  it("ranks by keystrokes saved and honours thresholds", () => {
    const history = [...entries("git status", 12), ...entries("ls", 50), ...entries("rare command here", 2)];
    const result = suggest(history, none, options);
    expect(result.map((s) => s.pattern)).toEqual(["git status"]);
    expect(result[0]).toMatchObject({ rank: 1, count: 12, score: 12 * (10 - 2), names: ["gs", "gst", "gis"] });
    expect(result[0]?.definition).toBe("alias gs='git status'");
  });

  it("uses sub-commands and templates, and skips covered exact commands", () => {
    const history = [
      ...entries("git checkout main", 3),
      ...entries("git checkout dev", 3),
      ...entries("cd /tmp && docker exec -it web bash", 3),
      ...entries("docker exec -it db bash", 3),
    ];
    const result = suggest(history, none, options);
    const patterns = result.map((s) => s.pattern);
    expect(patterns).toContain("git checkout <arg>");
    expect(patterns).not.toContain("git checkout main");
    const fn = result.find((s) => s.kind === "function");
    expect(fn?.pattern).toBe("docker exec -it <arg> bash");
    expect(fn?.definition).toMatch(/^\w+\(\) \{ docker exec -it "\$1" bash; \}$/);
  });

  it("never assigns the same name twice", () => {
    const history = [...entries("git status -sb", 9), ...entries("git stash -u", 9)];
    const names = suggest(history, none, options).map((s) => s.names[0]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns nothing for empty history", () => {
    expect(suggest([], none, options)).toEqual([]);
  });
});
