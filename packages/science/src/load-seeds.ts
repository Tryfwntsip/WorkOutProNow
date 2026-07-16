import { readdirSync, readFileSync } from "node:fs";

// seeds/ sits next to both src/ and dist/ (both are direct children of the
// package root), so "../seeds/" resolves correctly whether run from source
// (tsx) or built output.
const seedsDir = new URL("../seeds/", import.meta.url);

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, seedsDir), "utf8"));
}

export interface RawSeeds {
  muscles: unknown;
  equipment: unknown;
  joints: unknown;
  exercises: unknown;
  ruleSets: { file: string; data: unknown }[];
}

/** Read every seed artifact as raw (unvalidated) JSON. */
export function loadRawSeeds(): RawSeeds {
  const rulesDir = new URL("rules/", seedsDir);
  const ruleFiles = readdirSync(rulesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  return {
    muscles: readJson("taxonomy/muscles.json"),
    equipment: readJson("taxonomy/equipment.json"),
    joints: readJson("taxonomy/joints.json"),
    exercises: readJson("exercises.json"),
    ruleSets: ruleFiles.map((f) => ({ file: `rules/${f}`, data: readJson(`rules/${f}`) }))
  };
}
