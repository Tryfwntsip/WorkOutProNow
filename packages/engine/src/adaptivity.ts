import type { AdaptivityRules, ExerciseSeed } from "@myoadapt/science";
import type {
  AthleteState,
  DeloadStatus,
  ExerciseHistoryEntry,
  NextSetPrediction,
  PerformanceSet,
  ProgressionRecommendation,
  SessionPlan
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RULES: AdaptivityRules = {
  e1rmRepsDivisor: 30,
  fatigueDropPerSet: 0.75,
  fatigueHalfLifeHours: 48,
  fatiguePerSetScale: 0.12,
  secondaryMuscleCredit: 0.5,
  hardSetMaxRir: 2,
  loadIncrementPct: 0.025,
  minimumLoadIncrement: 2.5,
  deloadDeclinePct: 0.05,
  deloadFatigueThreshold: 0.65,
  deloadMinDecliningExercises: 2,
  recoveryVolumeMultiplier: 0.5,
  recoveryLoadMultiplier: 0.9,
  recoveryMinRir: 3
};

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Epley estimate adjusted by reported reps in reserve. */
export function estimateE1RM(
  set: Pick<PerformanceSet, "weight" | "reps" | "rir">,
  rules: AdaptivityRules = DEFAULT_RULES
): number | null {
  if (set.weight <= 0 || set.reps <= 0) return null;
  return rounded(set.weight * (1 + (set.reps + set.rir) / rules.e1rmRepsDivisor), 2);
}

export function updateExerciseHistory(
  previous: ExerciseHistoryEntry | undefined,
  set: PerformanceSet,
  rules: AdaptivityRules = DEFAULT_RULES
): ExerciseHistoryEntry {
  const estimate = estimateE1RM(set, rules);
  const predictedFromPrevious =
    previous?.e1RMEstimate && set.weight > 0
      ? rules.e1rmRepsDivisor * (previous.e1RMEstimate / set.weight - 1) - set.rir
      : undefined;
  const observedAdjustment =
    predictedFromPrevious === undefined
      ? undefined
      : clamp(set.reps - predictedFromPrevious, -5, 5);
  const repPerformanceAdjustment =
    observedAdjustment === undefined
      ? previous?.repPerformanceAdjustment
      : rounded(
          (previous?.repPerformanceAdjustment ?? observedAdjustment) * 0.7 +
            observedAdjustment * 0.3,
          2
        );
  const estimates = [...(previous?.recentE1RMs ?? []), ...(estimate ? [estimate] : [])].slice(-8);
  const smoothed =
    estimates.length > 0
      ? rounded(
          estimates.reduce((sum, value, index) => sum + value * (index + 1), 0) /
            estimates.reduce((sum, _value, index) => sum + index + 1, 0),
          2
        )
      : previous?.e1RMEstimate;
  return {
    ...(smoothed ? { e1RMEstimate: smoothed } : {}),
    ...(repPerformanceAdjustment !== undefined ? { repPerformanceAdjustment } : {}),
    lastLoads: [...(previous?.lastLoads ?? []), set.weight].slice(-8),
    recentE1RMs: estimates,
    lastPerformedAt: set.performedAt
  };
}

export function predictNextSet(input: {
  exerciseSlug: string;
  e1RMEstimate?: number;
  targetLoad: number | null;
  targetReps: { min: number; max: number };
  targetRir: number;
  completedSets: PerformanceSet[];
  repPerformanceAdjustment?: number;
  rules?: AdaptivityRules;
}): NextSetPrediction {
  const latest = input.completedSets.at(-1);
  const load = input.targetLoad ?? latest?.weight ?? null;
  const rules = input.rules ?? DEFAULT_RULES;
  const e1rm =
    input.e1RMEstimate ?? (latest ? (estimateE1RM(latest, rules) ?? undefined) : undefined);
  if (!load || load <= 0 || !e1rm) {
    return {
      exerciseSlug: input.exerciseSlug,
      predictedReps: input.targetReps.min,
      recommendedLoad: load,
      confidence: "low",
      rationale: "Cold-start prediction uses the lower bound of the target rep range"
    };
  }
  const baseReps =
    rules.e1rmRepsDivisor * (e1rm / load - 1) -
    input.targetRir +
    (input.repPerformanceAdjustment ?? 0);
  const fatigueDrop = input.completedSets.length * rules.fatigueDropPerSet;
  return {
    exerciseSlug: input.exerciseSlug,
    predictedReps: Math.round(clamp(baseReps - fatigueDrop, 1, input.targetReps.max + 3)),
    recommendedLoad: load,
    confidence: input.completedSets.length >= 2 ? "high" : "medium",
    rationale:
      `e1RM ${rounded(e1rm, 1)}, personalized adjustment ${rounded(input.repPerformanceAdjustment ?? 0, 1)}, ` +
      `minus ${rounded(fatigueDrop, 1)} reps of in-session fatigue`
  };
}

export function recommendProgression(input: {
  exerciseSlug: string;
  performed: PerformanceSet;
  targetReps: { min: number; max: number };
  targetRir: number;
  rules?: AdaptivityRules;
}): ProgressionRecommendation {
  const { performed, targetReps, targetRir } = input;
  const rules = input.rules ?? DEFAULT_RULES;
  if (performed.reps >= targetReps.max && performed.rir >= targetRir) {
    return {
      exerciseSlug: input.exerciseSlug,
      action: "increase_load",
      loadDelta:
        performed.weight > 0
          ? rounded(
              Math.max(rules.minimumLoadIncrement, performed.weight * rules.loadIncrementPct),
              1
            )
          : 0,
      rationale: "Top of rep range reached at or above target RIR"
    };
  }
  if (
    performed.reps >= targetReps.min &&
    performed.reps < targetReps.max &&
    performed.rir > targetRir
  ) {
    return {
      exerciseSlug: input.exerciseSlug,
      action: "increase_reps",
      loadDelta: 0,
      repDelta: Math.min(2, targetReps.max - performed.reps),
      rationale: "Add reps at the same load before increasing weight"
    };
  }
  if (performed.reps < targetReps.min || performed.rir < Math.max(targetRir - 1, 0)) {
    return {
      exerciseSlug: input.exerciseSlug,
      action: "reduce_load",
      loadDelta:
        performed.weight > 0
          ? -rounded(
              Math.max(rules.minimumLoadIncrement, performed.weight * rules.loadIncrementPct),
              1
            )
          : 0,
      rationale: "Performance fell below the target rep or effort range"
    };
  }
  return {
    exerciseSlug: input.exerciseSlug,
    action: "hold",
    loadDelta: 0,
    rationale: "Performance remains inside the target range"
  };
}

export function decayFatigue(
  score: number,
  elapsedHours: number,
  rules: AdaptivityRules = DEFAULT_RULES
): number {
  if (elapsedHours <= 0) return clamp(score, 0, 1);
  return rounded(clamp(score * 0.5 ** (elapsedHours / rules.fatigueHalfLifeHours), 0, 1), 4);
}

export function recomputeFatigue(input: {
  current: Record<string, number>;
  lastRecomputedAt?: string;
  asOf: string;
  exercises: ExerciseSeed[];
  performedSets: PerformanceSet[];
  rules?: AdaptivityRules;
}): Record<string, number> {
  const rules = input.rules ?? DEFAULT_RULES;
  const elapsedHours = input.lastRecomputedAt
    ? Math.max(0, (Date.parse(input.asOf) - Date.parse(input.lastRecomputedAt)) / (60 * 60 * 1000))
    : 0;
  const next = Object.fromEntries(
    Object.entries(input.current).map(([muscle, score]) => [
      muscle,
      decayFatigue(score, elapsedHours, rules)
    ])
  );
  const bySlug = new Map(input.exercises.map((exercise) => [exercise.slug, exercise]));
  for (const set of input.performedSets) {
    const exercise = bySlug.get(set.exerciseSlug);
    if (!exercise) continue;
    const effort = clamp(1 - set.rir / 5, 0.2, 1);
    for (const muscle of exercise.muscles) {
      const roleWeight = muscle.role === "primary" ? 1 : rules.secondaryMuscleCredit;
      const stimulus =
        exercise.stimulus.fatigueCost * effort * roleWeight * rules.fatiguePerSetScale;
      next[muscle.id] = rounded(clamp((next[muscle.id] ?? 0) + stimulus, 0, 1), 4);
    }
  }
  return next;
}

export function updateVolumeLedger(input: {
  current: Record<string, number>;
  exercises: ExerciseSeed[];
  performedSets: PerformanceSet[];
  rules?: AdaptivityRules;
}): Record<string, number> {
  const rules = input.rules ?? DEFAULT_RULES;
  const next = { ...input.current };
  const bySlug = new Map(input.exercises.map((exercise) => [exercise.slug, exercise]));
  for (const set of input.performedSets) {
    const exercise = bySlug.get(set.exerciseSlug);
    if (!exercise || set.rir > rules.hardSetMaxRir) continue;
    for (const muscle of exercise.muscles) {
      const credit = muscle.role === "primary" ? 1 : rules.secondaryMuscleCredit;
      next[muscle.id] = rounded((next[muscle.id] ?? 0) + credit, 1);
    }
  }
  return next;
}

export function detectDeload(input: {
  histories: Record<string, ExerciseHistoryEntry>;
  fatigue: Record<string, number>;
  asOf: string;
  rules?: AdaptivityRules;
}): DeloadStatus {
  const rules = input.rules ?? DEFAULT_RULES;
  const asOfMs = Date.parse(input.asOf);
  const declining = Object.entries(input.histories).filter(([, history]) => {
    const values = history.recentE1RMs ?? [];
    if (values.length < 4 || !history.lastPerformedAt) return false;
    if (asOfMs - Date.parse(history.lastPerformedAt) > 14 * DAY_MS) return false;
    const midpoint = Math.floor(values.length / 2);
    const earlier = values.slice(0, midpoint);
    const later = values.slice(midpoint);
    const earlierAvg = earlier.reduce((sum, value) => sum + value, 0) / earlier.length;
    const laterAvg = later.reduce((sum, value) => sum + value, 0) / later.length;
    return laterAvg < earlierAvg * (1 - rules.deloadDeclinePct);
  }).length;
  const fatigueValues = Object.values(input.fatigue);
  const averageFatigue = fatigueValues.length
    ? fatigueValues.reduce((sum, value) => sum + value, 0) / fatigueValues.length
    : 0;
  const recommended =
    declining >= rules.deloadMinDecliningExercises ||
    (declining >= 1 && averageFatigue >= rules.deloadFatigueThreshold);
  return {
    recommended,
    checkedAt: input.asOf,
    source: "automatic",
    reason: recommended
      ? `Detected ${declining} declining exercise trend(s) with average fatigue ${rounded(averageFatigue, 2)}`
      : "No sustained performance decline requiring a recovery week"
  };
}

export function applySpecialization(
  requested: Record<string, number>,
  availableMuscles: string[]
): Record<string, number> {
  const available = new Set(availableMuscles);
  const raw = Object.fromEntries(
    Object.entries(requested)
      .filter(([muscle]) => available.has(muscle))
      .map(([muscle, weight]) => [muscle, clamp(weight, 0.5, 2)])
  );
  const priorityCount = Object.values(raw).filter((weight) => weight > 1).length;
  if (priorityCount <= 3) return raw;
  return Object.fromEntries(
    Object.entries(raw).map(([muscle, weight]) => [
      muscle,
      weight > 1 ? rounded(1 + (weight - 1) * (3 / priorityCount), 2) : weight
    ])
  );
}

export function skippedSessionRedistribution(plan: SessionPlan): Record<string, number> {
  return Object.fromEntries(
    plan.muscleTargets.map((target) => [target.muscleId, target.targetSets])
  );
}

export function recomputeAfterSession(input: {
  athlete: AthleteState;
  plan: SessionPlan;
  exercises: ExerciseSeed[];
  performedSets: PerformanceSet[];
  volumeSets?: PerformanceSet[];
  rules?: AdaptivityRules;
  asOf: string;
}): {
  perExerciseHistory: Record<string, ExerciseHistoryEntry>;
  perMuscleFatigue: Record<string, number>;
  volumeLedger: Record<string, number>;
  deloadStatus: DeloadStatus;
} {
  const perExerciseHistory = { ...input.athlete.perExerciseHistory };
  for (const set of input.performedSets) {
    perExerciseHistory[set.exerciseSlug] = updateExerciseHistory(
      perExerciseHistory[set.exerciseSlug],
      set,
      input.rules
    );
  }
  const perMuscleFatigue = recomputeFatigue({
    current: input.athlete.perMuscleFatigue,
    lastRecomputedAt: input.athlete.lastRecomputedAt,
    asOf: input.asOf,
    exercises: input.exercises,
    performedSets: input.performedSets,
    rules: input.rules
  });
  const volumeLedger = updateVolumeLedger({
    current: input.volumeSets ? {} : input.athlete.volumeLedger,
    exercises: input.exercises,
    performedSets: input.volumeSets ?? input.performedSets,
    rules: input.rules
  });
  const detectedDeload = detectDeload({
    histories: perExerciseHistory,
    fatigue: perMuscleFatigue,
    asOf: input.asOf,
    rules: input.rules
  });
  return {
    perExerciseHistory,
    perMuscleFatigue,
    volumeLedger,
    deloadStatus:
      input.athlete.deloadStatus?.recommended && input.athlete.deloadStatus.source === "manual"
        ? input.athlete.deloadStatus
        : detectedDeload
  };
}
