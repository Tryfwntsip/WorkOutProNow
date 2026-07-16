/**
 * Minimal semver comparison for selecting the latest rule-set version.
 * Supports `major.minor.patch` with an optional pre-release tag; a release
 * outranks the same version with a pre-release (per the semver spec). Build
 * metadata is ignored for ordering.
 */

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function parse(version: string): ParsedSemver {
  const [coreAndPre] = version.split("+"); // drop build metadata
  const [core, prerelease] = coreAndPre!.split("-");
  const [major, minor, patch] = core!.split(".").map((n) => Number(n));
  return {
    major: major ?? 0,
    minor: minor ?? 0,
    patch: patch ?? 0,
    prerelease: prerelease ?? null
  };
}

/** Returns >0 if a > b, <0 if a < b, 0 if equal (ignoring build metadata). */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  // A normal version has higher precedence than a pre-release of the same core.
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease.localeCompare(pb.prerelease);
}

/** The highest version from a list, or undefined when the list is empty. */
export function latestSemver(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return [...versions].sort(compareSemver).at(-1);
}
