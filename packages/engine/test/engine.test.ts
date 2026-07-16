import { describe, expect, it } from "vitest";
import { validateSeeds } from "@myoadapt/science";
import { generateSession } from "../src/index.js";
import type { AthleteState, EngineCatalog, GenerationContext } from "../src/types.js";

const seeds = validateSeeds().seeds!;
const catalog: EngineCatalog = {
  exercises: seeds.exercises,
  muscleGroups: Object.fromEntries(seeds.muscles.map((m) => [m.id, m.muscleGroup]))
};
const rules = seeds.ruleSets.find((r) => r.version === "1.0.0")!;
const hypertrophyRules = seeds.ruleSets.find((r) => r.version === "1.1.0")!;

const athlete: AthleteState = {
  userId: "golden-athlete",
  revision: 3,
  trainingAge: "intermediate",
  recoveryProfile: 0.7,
  weeklySchedule: { days: [1, 2, 3, 4, 5], minutesPerDay: 60 },
  musclePriorities: { chest: 1.4, side_delts: 1.3 },
  excludedMuscles: [],
  injuries: [],
  environments: [
    {
      id: "full-gym",
      name: "Full Gym",
      equipment: [
        "barbell",
        "bench",
        "bodyweight",
        "cable",
        "dumbbell",
        "ez_bar",
        "machine",
        "pullup_bar"
      ]
    }
  ],
  perExerciseHistory: {
    barbell_bench_press: { e1RMEstimate: 100 },
    overhead_press: { e1RMEstimate: 60 }
  },
  perMuscleFatigue: { chest: 0.1, triceps: 0.2 },
  volumeLedger: { chest: 2, front_delts: 2, side_delts: 1, triceps: 3 }
};

const context: GenerationContext = {
  date: "2026-06-08",
  minutesAvailable: 45,
  environmentId: "full-gym"
};

describe("E2 deterministic engine", () => {
  it("generates a first plan when the persisted default schedule is empty", () => {
    const newAthlete = { ...athlete, weeklySchedule: {} as AthleteState["weeklySchedule"] };
    expect(() => generateSession({ athlete: newAthlete, context, catalog, rules })).not.toThrow();
  });

  it("matches the rule-set 1.0.0 golden plan", async () => {
    const plan = generateSession({ athlete, context, catalog, rules });
    await expect(JSON.stringify(plan, null, 2)).toMatchFileSnapshot(
      "./golden/rules-1.0.0-push.json"
    );
  });

  it("returns byte-identical output for identical input", () => {
    const first = generateSession({ athlete, context, catalog, rules });
    const second = generateSession({ athlete, context, catalog, rules });
    expect(second).toEqual(first);
    expect(second.planId).toBe(first.planId);
  });

  it("only prescribes exercises whose required equipment is available", () => {
    const available = ["dumbbell", "bench"];
    const limited = {
      ...athlete,
      environments: [{ id: "minimal", name: "Minimal", equipment: available }]
    };
    const plan = generateSession({
      athlete: limited,
      context: { ...context, environmentId: "minimal" },
      catalog,
      rules
    });
    const bySlug = new Map(catalog.exercises.map((e) => [e.slug, e]));
    expect(plan.exercises.length).toBeGreaterThan(0);
    for (const planned of plan.exercises) {
      const required = bySlug
        .get(planned.exerciseSlug)!
        .equipment.filter((e) => e.required)
        .map((e) => e.id);
      for (const eq of required) expect(available).toContain(eq);
    }
  });

  it("excludes contraindicated exercises for an injury", () => {
    const injured = {
      ...athlete,
      injuries: [{ jointOrMuscle: "shoulder", severity: "moderate" as const, constraints: {} }]
    };
    const plan = generateSession({ athlete: injured, context, catalog, rules });
    expect(plan.exercises.map((e) => e.exerciseSlug)).not.toContain("barbell_bench_press");
    expect(plan.exercises.map((e) => e.exerciseSlug)).not.toContain("overhead_press");
  });

  it("fits prescribed work within the requested time when trimmable", () => {
    const plan = generateSession({
      athlete,
      context: { ...context, minutesAvailable: 20 },
      catalog,
      rules
    });
    expect(plan.estimatedDurationMinutes).toBeLessThanOrEqual(20);
    expect(plan.exercises.every((e) => e.sets.length >= 1)).toBe(true);
  });
});

describe("user-selected split programs", () => {
  it("follows the chosen split rotation instead of auto-deriving the routine", () => {
    // 2026-06-08 is a Monday (weekday 1) → slot 0 in [1,3,5] → first routine.
    const withProgram: AthleteState = {
      ...athlete,
      weeklySchedule: { days: [1, 3, 5], minutesPerDay: 60 },
      program: {
        splitId: "push_pull_legs",
        daysPerWeek: 3,
        weeklyRoutines: ["push", "pull", "legs"]
      }
    };
    const plan = generateSession({ athlete: withProgram, context, catalog, rules });
    expect(plan.routine).toBe("push");
    expect(plan.rationale.some((r) => r.code === "routine.user_selected_split")).toBe(true);
  });

  it("targets Arnold chest+back muscles on a chest_back day", () => {
    const arnold: AthleteState = {
      ...athlete,
      weeklySchedule: { days: [1, 2, 3, 4, 5, 6], minutesPerDay: 70 },
      program: {
        splitId: "arnold",
        daysPerWeek: 6,
        weeklyRoutines: [
          "chest_back",
          "shoulders_arms",
          "legs",
          "chest_back",
          "shoulders_arms",
          "legs"
        ]
      }
    };
    const plan = generateSession({ athlete: arnold, context, catalog, rules });
    expect(plan.routine).toBe("chest_back");
    const allowed = new Set(["chest", "lats", "upper_back", "traps", "rear_delts"]);
    expect(plan.muscleTargets.length).toBeGreaterThan(0);
    for (const target of plan.muscleTargets) expect(allowed.has(target.muscleId)).toBe(true);
  });

  it("stays deterministic with a program set", () => {
    const withProgram: AthleteState = {
      ...athlete,
      program: {
        splitId: "push_pull_legs",
        daysPerWeek: 3,
        weeklyRoutines: ["push", "pull", "legs"]
      }
    };
    const a = generateSession({ athlete: withProgram, context, catalog, rules });
    const b = generateSession({ athlete: withProgram, context, catalog, rules });
    expect(a.planId).toBe(b.planId);
  });
});

describe("hypertrophy rule set 1.1.0", () => {
  it("uses training-age volume ranges and a bounded specialization ceiling", () => {
    const beginner = generateSession({
      athlete: { ...athlete, trainingAge: "beginner", musclePriorities: { chest: 2 } },
      context: { ...context, minutesAvailable: 180 },
      catalog,
      rules: hypertrophyRules
    });
    const advanced = generateSession({
      athlete: { ...athlete, trainingAge: "advanced", musclePriorities: { chest: 2 } },
      context: { ...context, minutesAvailable: 180 },
      catalog,
      rules: hypertrophyRules
    });
    const beginnerChest = beginner.muscleTargets.find((target) => target.muscleId === "chest")!;
    const advancedChest = advanced.muscleTargets.find((target) => target.muscleId === "chest")!;
    expect(beginnerChest.rationale[0]?.facts.weeklyTarget).toBe(10);
    expect(advancedChest.rationale[0]?.facts.weeklyTarget).toBe(29);
    expect(advancedChest.rationale[0]?.facts.muscleFrequency).toBe(2);
  });

  it("prescribes practical reps, 0-2 RIR and adequate rest", () => {
    const plan = generateSession({ athlete, context, catalog, rules: hypertrophyRules });
    expect(plan.exercises.length).toBeGreaterThan(0);
    for (const exercise of plan.exercises) {
      expect(exercise.sets.length).toBeGreaterThanOrEqual(3);
      expect(exercise.sets.length).toBeLessThanOrEqual(4);
      expect(exercise.restSeconds).toBeGreaterThanOrEqual(
        exercise.mechanic === "compound" ? 150 : 90
      );
      for (const set of exercise.sets) {
        expect(set.targetReps.min).toBeGreaterThanOrEqual(5);
        expect(set.targetReps.max).toBeLessThanOrEqual(15);
        expect(set.targetRir).toBeGreaterThanOrEqual(0);
        expect(set.targetRir).toBeLessThanOrEqual(2);
      }
      expect(exercise.sets.at(-1)?.targetRir).toBe(0.5);
    }
  });

  it("builds the default recommended session around 45 minutes", () => {
    const plan = generateSession({
      athlete: {
        ...athlete,
        weeklySchedule: { days: [1, 3, 5] },
        volumeLedger: {},
        sessionPreferences: { volumeLevel: "recommended", exercisesPerSession: 5 }
      },
      context: { date: context.date, environmentId: context.environmentId },
      catalog,
      rules: hypertrophyRules
    });
    expect(plan.estimatedDurationMinutes).toBeGreaterThanOrEqual(40);
    expect(plan.estimatedDurationMinutes).toBeLessThanOrEqual(45);
  });

  it("lets the user reduce or increase volume within bounded targets", () => {
    const baseAthlete = {
      ...athlete,
      trainingAge: "advanced" as const,
      musclePriorities: { chest: 2 },
      sessionPreferences: { volumeLevel: "recommended" as const, exercisesPerSession: 5 }
    };
    const reduced = generateSession({
      athlete: {
        ...baseAthlete,
        sessionPreferences: { volumeLevel: "reduced", exercisesPerSession: 5 }
      },
      context,
      catalog,
      rules: hypertrophyRules
    });
    const increased = generateSession({
      athlete: {
        ...baseAthlete,
        sessionPreferences: { volumeLevel: "increased", exercisesPerSession: 5 }
      },
      context,
      catalog,
      rules: hypertrophyRules
    });
    const reducedChest = reduced.muscleTargets.find((target) => target.muscleId === "chest")!;
    const increasedChest = increased.muscleTargets.find((target) => target.muscleId === "chest")!;
    expect(reducedChest.rationale[0]?.facts.weeklyTarget).toBeLessThan(
      increasedChest.rationale[0]?.facts.weeklyTarget as number
    );
    expect(increasedChest.rationale[0]?.facts.weeklyTarget).toBeLessThanOrEqual(30);
  });

  it("honors preferred exercise count by splitting safe volume across variations", () => {
    const lowVariety = generateSession({
      athlete: {
        ...athlete,
        sessionPreferences: { volumeLevel: "recommended", exercisesPerSession: 3 }
      },
      context,
      catalog,
      rules: hypertrophyRules
    });
    const highVariety = generateSession({
      athlete: {
        ...athlete,
        sessionPreferences: { volumeLevel: "recommended", exercisesPerSession: 7 }
      },
      context,
      catalog,
      rules: hypertrophyRules
    });
    expect(lowVariety.exercises.length).toBeLessThanOrEqual(3);
    expect(highVariety.exercises.length).toBeGreaterThan(lowVariety.exercises.length);
    expect(highVariety.exercises.length).toBeLessThanOrEqual(7);

    const exerciseCountByMuscle = highVariety.exercises.reduce<Record<string, number>>(
      (sum, exercise) => {
        sum[exercise.primaryMuscle] = (sum[exercise.primaryMuscle] ?? 0) + 1;
        return sum;
      },
      {}
    );
    const highSetsByMuscle = highVariety.exercises.reduce<Record<string, number>>(
      (sum, exercise) => {
        sum[exercise.primaryMuscle] = (sum[exercise.primaryMuscle] ?? 0) + exercise.sets.length;
        return sum;
      },
      {}
    );
    const targetSetBudget = highVariety.muscleTargets.reduce(
      (sum, target) => sum + target.targetSets,
      0
    );
    const prescribedSets = Object.values(highSetsByMuscle).reduce((sum, sets) => sum + sets, 0);
    expect(Object.values(exerciseCountByMuscle).some((count) => count > 1)).toBe(true);
    expect(prescribedSets).toBeLessThanOrEqual(targetSetBudget);
    expect(highVariety.exercises.every((exercise) => exercise.sets.length >= 1)).toBe(true);
  });

  it("prioritizes major movement groups in a five-day full-body program", () => {
    const plan = generateSession({
      athlete: {
        ...athlete,
        weeklySchedule: { days: [1, 2, 3, 4, 5], minutesPerDay: 45 },
        musclePriorities: {},
        volumeLedger: {},
        program: {
          splitId: "full_body",
          daysPerWeek: 5,
          weeklyRoutines: ["full_body", "full_body", "full_body", "full_body", "full_body"]
        },
        sessionPreferences: { volumeLevel: "recommended", exercisesPerSession: 5 }
      },
      context: { ...context, minutesAvailable: 45 },
      catalog,
      rules: hypertrophyRules
    });
    const targeted = plan.muscleTargets.map((target) => target.muscleId);
    expect(targeted).toEqual(["chest", "lats", "quads", "side_delts", "biceps"]);
    expect(plan.exercises.map((exercise) => exercise.exerciseSlug)).not.toContain(
      "dumbbell_wrist_curl"
    );
    expect(plan.estimatedDurationMinutes).toBeGreaterThanOrEqual(40);
    expect(plan.estimatedDurationMinutes).toBeLessThanOrEqual(45);
  });

  it("keeps upper-body sessions balanced and does not prioritize forearms over major muscles", () => {
    const plan = generateSession({
      athlete: {
        ...athlete,
        weeklySchedule: { days: [1, 2, 4, 5], minutesPerDay: 60 },
        musclePriorities: {},
        volumeLedger: {},
        program: {
          splitId: "upper_lower",
          daysPerWeek: 4,
          weeklyRoutines: ["upper", "lower", "upper", "lower"]
        },
        sessionPreferences: { volumeLevel: "recommended", exercisesPerSession: 5 }
      },
      context: { ...context, minutesAvailable: 60 },
      catalog,
      rules: hypertrophyRules
    });
    const targeted = plan.muscleTargets.map((target) => target.muscleId);
    expect(targeted).toEqual(["chest", "lats", "upper_back", "side_delts", "biceps"]);
    expect(plan.exercises.map((exercise) => exercise.exerciseSlug)).not.toContain(
      "dumbbell_wrist_curl"
    );
    expect(plan.exercises.every((exercise) => exercise.sets.length >= 3)).toBe(true);
    expect(plan.exercises.every((exercise) => exercise.sets.length <= 4)).toBe(true);
  });
});

describe("science-based selection details (1.1.0)", () => {
  const mini = (
    slug: string,
    pattern: string,
    mechanic: "compound" | "isolation",
    loadability: number,
    repRange: { min: number; max: number },
    muscle = "chest",
    equipment: string[] = []
  ) => ({
    slug,
    name: slug,
    mechanic,
    movementPattern: pattern,
    isUnilateral: false,
    stimulus: { loadability, stability: 0.7, stretchEmphasis: 0.6, fatigueCost: 0.4 },
    repRange,
    restBand: { minSeconds: 90, maxSeconds: 180 },
    muscles: [{ id: muscle, role: "primary" as const }],
    equipment: equipment.map((id) => ({ id, required: true })),
    jointStress: [],
    contraindicatedInjuries: [],
    status: "approved" as const
  });
  const miniCatalog: EngineCatalog = {
    muscleGroups: { chest: "push" },
    exercises: [
      mini("alpha_press", "horizontal_press", "compound", 0.9, { min: 5, max: 12 }),
      mini("beta_press", "horizontal_press", "compound", 0.85, { min: 5, max: 12 }),
      mini("gamma_fly", "fly", "isolation", 0.5, { min: 8, max: 15 })
    ]
  };
  const focusAthlete: AthleteState = {
    ...athlete,
    musclePriorities: {},
    volumeLedger: {},
    perMuscleFatigue: {},
    sessionPreferences: { volumeLevel: "recommended", exercisesPerSession: 2 }
  };
  const focusContext = { ...context, minutesAvailable: 120 };

  it("prefers a different movement pattern for a muscle's second exercise", () => {
    const plan = generateSession({
      athlete: focusAthlete,
      context: focusContext,
      catalog: miniCatalog,
      rules: hypertrophyRules
    });
    // beta_press scores higher than gamma_fly but repeats the pattern of
    // alpha_press, so the fly wins the second slot for regional coverage.
    expect(plan.exercises.map((e) => e.exerciseSlug).sort()).toEqual(["alpha_press", "gamma_fly"]);
    const fly = plan.exercises.find((e) => e.exerciseSlug === "gamma_fly")!;
    expect(fly.rationale.some((tag) => tag.code === "exercise.pattern_variety")).toBe(true);
  });

  it("prioritizes dumbbells and cables over machines for user-preferred upper-body muscles", () => {
    const preferredCatalog: EngineCatalog = {
      muscleGroups: { chest: "push", side_delts: "push", biceps: "push", triceps: "push" },
      exercises: [
        mini("barbell_chest", "press", "compound", 0.95, { min: 5, max: 12 }, "chest", ["barbell"]),
        mini("machine_chest", "press", "compound", 0.95, { min: 5, max: 12 }, "chest", ["machine"]),
        mini("dumbbell_chest", "press", "compound", 0.75, { min: 5, max: 12 }, "chest", [
          "dumbbell"
        ]),
        mini(
          "machine_lateral",
          "abduction",
          "isolation",
          0.95,
          { min: 10, max: 15 },
          "side_delts",
          ["machine"]
        ),
        mini("cable_lateral", "abduction", "isolation", 0.7, { min: 10, max: 15 }, "side_delts", [
          "cable"
        ]),
        mini("ez_curl", "curl", "isolation", 0.95, { min: 8, max: 15 }, "biceps", ["ez_bar"]),
        mini("dumbbell_curl", "curl", "isolation", 0.7, { min: 8, max: 15 }, "biceps", [
          "dumbbell"
        ]),
        mini("dip_triceps", "extension", "compound", 0.95, { min: 8, max: 15 }, "triceps", [
          "bodyweight"
        ]),
        mini("cable_triceps", "extension", "isolation", 0.65, { min: 8, max: 15 }, "triceps", [
          "cable"
        ])
      ]
    };
    const plan = generateSession({
      athlete: {
        ...focusAthlete,
        sessionPreferences: { volumeLevel: "recommended", exercisesPerSession: 4 }
      },
      context: focusContext,
      catalog: preferredCatalog,
      rules: hypertrophyRules
    });
    expect(plan.exercises.map((exercise) => exercise.exerciseSlug).sort()).toEqual([
      "cable_lateral",
      "cable_triceps",
      "dumbbell_chest",
      "dumbbell_curl"
    ]);
  });

  it("gives the first exercise the heavy range and accessories the lighter range", () => {
    const plan = generateSession({
      athlete: focusAthlete,
      context: focusContext,
      catalog: miniCatalog,
      rules: hypertrophyRules
    });
    const press = plan.exercises.find((e) => e.exerciseSlug === "alpha_press")!;
    const fly = plan.exercises.find((e) => e.exerciseSlug === "gamma_fly")!;
    expect(press.sets[0]!.targetReps).toEqual({ min: 5, max: 10 });
    expect(fly.sets[0]!.targetReps).toEqual({ min: 10, max: 15 });
  });

  it("orders specialized-muscle work first while fresh", () => {
    const catalogWithBiceps: EngineCatalog = {
      muscleGroups: { chest: "push", biceps: "push" },
      exercises: [
        mini("alpha_press", "horizontal_press", "compound", 0.9, { min: 5, max: 12 }),
        mini("curl_iso", "elbow_flexion", "isolation", 0.55, { min: 8, max: 15 }, "biceps")
      ]
    };
    const plan = generateSession({
      athlete: { ...focusAthlete, musclePriorities: { biceps: 1.5 } },
      context: focusContext,
      catalog: catalogWithBiceps,
      rules: hypertrophyRules
    });
    expect(plan.exercises[0]!.primaryMuscle).toBe("biceps");
    expect(plan.rationale.some((tag) => tag.code === "ordering.priority_muscle_first")).toBe(true);
  });
});
