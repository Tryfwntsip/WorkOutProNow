import { describe, expect, it } from "vitest";
import { compareSemver, latestSemver } from "../src/semver.js";

describe("compareSemver", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareSemver("1.1.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.1.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.10", "1.0.2")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("ranks a release above its pre-release", () => {
    expect(compareSemver("1.1.0", "1.1.0-beta")).toBeGreaterThan(0);
    expect(compareSemver("1.1.0-beta", "1.1.0")).toBeLessThan(0);
  });

  it("ignores build metadata", () => {
    expect(compareSemver("1.1.0+build5", "1.1.0")).toBe(0);
  });
});

describe("latestSemver", () => {
  it("returns the highest version regardless of input order", () => {
    expect(latestSemver(["1.0.0", "1.1.0", "1.0.5"])).toBe("1.1.0");
    expect(latestSemver(["2.3.0", "2.10.0", "2.9.9"])).toBe("2.10.0");
  });

  it("returns undefined for an empty list", () => {
    expect(latestSemver([])).toBeUndefined();
  });
});
