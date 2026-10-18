import { describe, expect, it, vi } from "vitest";

describe("cli", () => {
  it("prints the version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run } = await import("../src/cli.js");
    expect(run(["--version"])).toBe(0);
    expect(log).toHaveBeenCalledWith("0.0.0");
    log.mockRestore();
  });
});
