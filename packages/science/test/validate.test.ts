import { describe, expect, it } from "vitest";
import { exerciseSeedSchema, ruleSetSchema } from "../src/schemas.js";
import { validateSeeds } from "../src/validate.js";

describe("curated seed validation (E1.4)", () => {
  const result = validateSeeds();

  it("passes structural + referential integrity over the real seeds", () => {
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("loads the expected catalog", () => {
    const s = result.seeds!;
    expect(s.muscles.length).toBeGreaterThanOrEqual(16);
    expect(s.equipment.length).toBeGreaterThanOrEqual(8);
    expect(s.exercises.length).toBeGreaterThanOrEqual(10);
    expect(s.ruleSets.map((r) => r.version)).toContain("1.0.0");
    expect(s.ruleSets.map((r) => r.version)).toContain("1.1.0");
  });

  it("every curated exercise is approved and has a primary muscle", () => {
    for (const ex of result.seeds!.exercises) {
      expect(ex.status).toBe("approved");
      expect(ex.muscles.some((m) => m.role === "primary")).toBe(true);
    }
  });

  it("every exercise muscle/equipment/joint id resolves to taxonomy", () => {
    const s = result.seeds!;
    const muscleIds = new Set(s.muscles.map((m) => m.id));
    const equipmentIds = new Set(s.equipment.map((e) => e.id));
    const jointIds = new Set(s.joints.map((j) => j.id));
    for (const ex of s.exercises) {
      ex.muscles.forEach((m) => expect(muscleIds.has(m.id)).toBe(true));
      ex.equipment.forEach((e) => expect(equipmentIds.has(e.id)).toBe(true));
      ex.jointStress.forEach((j) => expect(jointIds.has(j.id)).toBe(true));
    }
  });
});

describe("exercise schema guards", () => {
  const base = {
    slug: "test_ex",
    name: "Test",
    mechanic: "isolation",
    stimulus: { loadability: 0.5, stability: 0.5, stretchEmphasis: 0.5, fatigueCost: 0.5 },
    repRange: { min: 8, max: 12 },
    restBand: { minSeconds: 60, maxSeconds: 90 },
    muscles: [{ id: "biceps", role: "primary" }]
  };

  it("rejects stimulus values outside 0..1", () => {
    const bad = { ...base, stimulus: { ...base.stimulus, loadability: 1.5 } };
    expect(exerciseSeedSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects inverted rep ranges", () => {
    expect(exerciseSeedSchema.safeParse({ ...base, repRange: { min: 12, max: 8 } }).success).toBe(
      false
    );
  });

  it("rejects an exercise with no primary muscle", () => {
    const bad = { ...base, muscles: [{ id: "biceps", role: "secondary" }] };
    expect(exerciseSeedSchema.safeParse(bad).success).toBe(false);
  });
});

describe("rule set schema guards (E1.3)", () => {
  it("rejects a non-semver version", () => {
    const rs = {
      version: "1.0",
      weeklyVolume: { default: { min: 8, max: 12 } },
      setsPerSessionCap: 10,
      repRanges: [{ min: 5, max: 10 }],
      rir: { min: 0, max: 3 },
      restSecondsByMechanic: { compound: { min: 120, max: 180 }, isolation: { min: 60, max: 120 } }
    };
    expect(ruleSetSchema.safeParse(rs).success).toBe(false);
  });

  it("accepts the canonical shape", () => {
    const rs = {
      version: "1.2.3",
      weeklyVolume: { default: { min: 8, max: 12 }, perMuscle: { calves: { min: 10, max: 16 } } },
      setsPerSessionCap: 10,
      repRanges: [{ min: 5, max: 10 }],
      rir: { min: 0, max: 3 },
      restSecondsByMechanic: { compound: { min: 120, max: 180 }, isolation: { min: 60, max: 120 } }
    };
    expect(ruleSetSchema.safeParse(rs).success).toBe(true);
  });

  it("accepts training-age volume and hard-set effort rules", () => {
    const rs = {
      version: "1.1.0",
      weeklyVolume: {
        default: { min: 8, max: 15 },
        byTrainingAge: {
          beginner: { min: 4, max: 10 },
          intermediate: { min: 8, max: 15 },
          advanced: { min: 11, max: 18 }
        },
        specializationMaxByTrainingAge: { beginner: 10, intermediate: 20, advanced: 30 }
      },
      setsPerSessionCap: 10,
      repRanges: [{ min: 5, max: 15 }],
      rir: { min: 0, max: 2 },
      restSecondsByMechanic: {
        compound: { min: 150, max: 180 },
        isolation: { min: 90, max: 120 }
      }
    };
    expect(ruleSetSchema.safeParse(rs).success).toBe(true);
  });
});
