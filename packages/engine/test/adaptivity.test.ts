import { describe, expect, it } from "vitest";
import { validateSeeds } from "@myoadapt/science";
import {
  applySpecialization,
  decayFatigue,
  detectDeload,
  estimateE1RM,
  predictNextSet,
  recommendProgression,
  recomputeAfterSession,
  skippedSessionRedistribution,
  updateExerciseHistory,
  updateVolumeLedger
} from "../src/index.js";
import type { AthleteState, PerformanceSet, SessionPlan } from "../src/types.js";

const seeds = validateSeeds().seeds!;
const exercises = seeds.exercises;

const performed = (overrides: Partial<PerformanceSet> = {}): PerformanceSet => ({
  exerciseSlug: "barbell_bench_press",
  setIndex: 1,
  weight: 80,
  reps: 10,
  rir: 2,
  performedAt: "2026-06-08T10:00:00.000Z",
  ...overrides
});

describe("E3 exercise performance and prediction", () => {
  it("estimates e1RM with reported RIR", () => {
    expect(estimateE1RM(performed())).toBe(112);
    expect(estimateE1RM(performed({ weight: -20 }))).toBeNull();
  });

  it("uses the active rule-set thresholds", () => {
    const rules = { ...seeds.ruleSets[0]!.adaptivity, e1rmRepsDivisor: 40 };
    expect(estimateE1RM(performed(), rules)).toBe(104);
  });

  it("predicts fewer reps as in-session fatigue accumulates", () => {
    const first = predictNextSet({
      exerciseSlug: "barbell_bench_press",
      e1RMEstimate: 112,
      targetLoad: 80,
      targetReps: { min: 5, max: 10 },
      targetRir: 2,
      completedSets: [performed()]
    });
    const third = predictNextSet({
      exerciseSlug: "barbell_bench_press",
      e1RMEstimate: 112,
      targetLoad: 80,
      targetReps: { min: 5, max: 10 },
      targetRir: 2,
      completedSets: [performed(), performed({ setIndex: 2 }), performed({ setIndex: 3 })]
    });
    expect(third.predictedReps).toBeLessThan(first.predictedReps);
  });

  it("learns and applies an exercise-specific rep-performance adjustment", () => {
    const history = updateExerciseHistory(
      { e1RMEstimate: 100, repPerformanceAdjustment: 1 },
      performed()
    );
    const baseline = predictNextSet({
      exerciseSlug: "barbell_bench_press",
      e1RMEstimate: 112,
      targetLoad: 80,
      targetReps: { min: 5, max: 15 },
      targetRir: 2,
      completedSets: []
    });
    const personalized = predictNextSet({
      exerciseSlug: "barbell_bench_press",
      e1RMEstimate: 112,
      targetLoad: 80,
      targetReps: { min: 5, max: 15 },
      targetRir: 2,
      completedSets: [],
      repPerformanceAdjustment: history.repPerformanceAdjustment
    });
    expect(personalized.predictedReps).toBeGreaterThan(baseline.predictedReps);
  });

  it("recommends progression only after reaching the top of the range at target effort", () => {
    expect(
      recommendProgression({
        exerciseSlug: "barbell_bench_press",
        performed: performed(),
        targetReps: { min: 5, max: 10 },
        targetRir: 2
      }).action
    ).toBe("increase_load");
  });

  it("adds reps before load when effort allows progressive overload", () => {
    expect(
      recommendProgression({
        exerciseSlug: "barbell_bench_press",
        performed: performed({ reps: 8, rir: 2 }),
        targetReps: { min: 5, max: 10 },
        targetRir: 1
      })
    ).toMatchObject({ action: "increase_reps", repDelta: 2, loadDelta: 0 });
  });

  it("credits only 0-2 RIR hard sets and gives secondary muscles half credit", () => {
    const rules = seeds.ruleSets.find((rule) => rule.version === "1.1.0")!.adaptivity;
    const ledger = updateVolumeLedger({
      current: {},
      exercises,
      performedSets: [performed({ rir: 2 }), performed({ setIndex: 2, rir: 3 })],
      rules
    });
    expect(ledger.chest).toBe(1);
    expect(ledger.triceps).toBe(0.5);
  });
});

describe("E3 fatigue, deload and specialization", () => {
  it("halves fatigue after the configured 48-hour half-life", () => {
    expect(decayFatigue(0.8, 48)).toBe(0.4);
  });

  it("detects sustained decline under high fatigue", () => {
    expect(
      detectDeload({
        histories: {
          bench: {
            recentE1RMs: [110, 109, 100, 99],
            lastPerformedAt: "2026-06-08T10:00:00.000Z"
          }
        },
        fatigue: { chest: 0.8, triceps: 0.7 },
        asOf: "2026-06-09T10:00:00.000Z"
      }).recommended
    ).toBe(true);
  });

  it("caps broad specialization so recovery demand stays bounded", () => {
    const priorities = applySpecialization({ chest: 2, lats: 2, quads: 2, hamstrings: 2 }, [
      "chest",
      "lats",
      "quads",
      "hamstrings"
    ]);
    expect(Object.values(priorities).every((weight) => weight <= 1.75)).toBe(true);
  });
});

describe("E3 session recompute", () => {
  const athlete: AthleteState = {
    userId: "athlete",
    revision: 1,
    trainingAge: "intermediate",
    recoveryProfile: 0.7,
    weeklySchedule: { days: [1, 3, 5] },
    musclePriorities: {},
    excludedMuscles: [],
    injuries: [],
    environments: [],
    perExerciseHistory: {},
    perMuscleFatigue: {},
    volumeLedger: {}
  };
  const plan = {
    muscleTargets: [{ muscleId: "chest", targetSets: 3 }]
  } as SessionPlan;

  it("updates histories, fatigue and rolling volume after completion", () => {
    const result = recomputeAfterSession({
      athlete,
      plan,
      exercises,
      performedSets: [performed()],
      volumeSets: [performed()],
      asOf: "2026-06-08T11:00:00.000Z"
    });
    expect(result.perExerciseHistory.barbell_bench_press?.e1RMEstimate).toBe(112);
    expect(result.perMuscleFatigue.chest).toBeGreaterThan(0);
    expect(result.volumeLedger.chest).toBe(1);
    expect(result.volumeLedger.triceps).toBe(0.5);
  });

  it("keeps a manually enabled recovery week active until explicitly disabled", () => {
    const result = recomputeAfterSession({
      athlete: {
        ...athlete,
        deloadStatus: {
          recommended: true,
          source: "manual",
          reason: "Recovery week enabled manually"
        }
      },
      plan,
      exercises,
      performedSets: [],
      asOf: "2026-06-08T11:00:00.000Z"
    });
    expect(result.deloadStatus).toMatchObject({ recommended: true, source: "manual" });
  });

  it("redistributes a skipped plan without adding performed volume", () => {
    expect(skippedSessionRedistribution(plan)).toEqual({ chest: 3 });
  });
});
