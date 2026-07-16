import { createHash } from "node:crypto";
import type { ExerciseSeed, RuleSet } from "@myoadapt/science";
import type {
  AthleteState,
  EngineCatalog,
  EngineInput,
  GenerationContext,
  MuscleTarget,
  PipelineObserver,
  PipelineStage,
  PlannedExercise,
  PlannedSet,
  RationaleTag,
  Routine,
  SessionPlan
} from "./types.js";

const CONTRACT_VERSION = "1.0.0" as const;

/**
 * Which muscles a routine targets. Most routines select by muscle GROUP; the
 * Arnold-split days (chest_back / shoulders_arms) need a finer, explicit muscle
 * allow-list because they cut across the push/pull groups.
 */
const ROUTINE_DEFINITIONS: Record<Routine, { groups?: string[]; muscles?: string[] }> = {
  full_body: { groups: ["push", "pull", "legs", "core"] },
  upper: { groups: ["push", "pull", "core"] },
  lower: { groups: ["legs", "core"] },
  push: { groups: ["push"] },
  pull: { groups: ["pull"] },
  legs: { groups: ["legs", "core"] },
  chest_back: { muscles: ["chest", "lats", "upper_back", "traps", "rear_delts"] },
  shoulders_arms: {
    muscles: ["front_delts", "side_delts", "rear_delts", "triceps", "biceps", "forearms"]
  }
};

const FULL_BODY_MUSCLE_PRIORITY = [
  "chest",
  "lats",
  "quads",
  "side_delts",
  "biceps",
  "triceps",
  "hamstrings",
  "upper_back",
  "glutes",
  "rear_delts",
  "abs",
  "calves",
  "front_delts",
  "traps",
  "lower_back",
  "forearms"
] as const;

const ROUTINE_MUSCLE_PRIORITY: Partial<Record<Routine, readonly string[]>> = {
  full_body: FULL_BODY_MUSCLE_PRIORITY,
  upper: [
    "chest",
    "lats",
    "upper_back",
    "side_delts",
    "biceps",
    "triceps",
    "rear_delts",
    "front_delts",
    "traps",
    "abs",
    "forearms",
    "lower_back"
  ],
  lower: ["quads", "hamstrings", "glutes", "calves", "abs", "lower_back"],
  push: ["chest", "side_delts", "triceps", "front_delts"],
  pull: ["lats", "upper_back", "biceps", "rear_delts", "traps", "forearms"],
  legs: ["quads", "hamstrings", "glutes", "calves", "abs", "lower_back"],
  chest_back: ["chest", "lats", "upper_back", "rear_delts", "traps"],
  shoulders_arms: ["side_delts", "rear_delts", "front_delts", "triceps", "biceps", "forearms"]
};

const MIN_HYPERTROPHY_SETS_PER_EXERCISE = 3;
const MAX_SETS_PER_EXERCISE = 4;

function routineTargetsMuscle(routine: Routine, muscleId: string, group: string): boolean {
  const def = ROUTINE_DEFINITIONS[routine];
  if (def.muscles) return def.muscles.includes(muscleId);
  return def.groups?.includes(group) ?? false;
}

function routineMuscleCap(routine: Routine, requestedExercises?: number): number {
  const defaultCap = routine === "full_body" ? 6 : 5;
  return requestedExercises ? Math.min(8, requestedExercises) : defaultCap;
}

function rationale(
  stage: PipelineStage,
  code: string,
  message: string,
  facts: RationaleTag["facts"] = {}
): RationaleTag {
  return { stage, code, message, facts };
}

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stableSort<T>(values: T[], score: (value: T) => number, tie: (value: T) => string): T[] {
  return [...values].sort((a, b) => score(b) - score(a) || tie(a).localeCompare(tie(b)));
}

function timed<T>(
  stage: PipelineStage,
  observer: PipelineObserver | undefined,
  run: () => T,
  rationales: (result: T) => RationaleTag[]
): T {
  const start = performance.now();
  const result = run();
  observer?.stageCompleted?.(stage, performance.now() - start, rationales(result).length);
  return result;
}

function normalizeContext(athlete: AthleteState, context: GenerationContext) {
  const environment = context.environmentId
    ? athlete.environments.find((e) => e.id === context.environmentId)
    : athlete.environments[0];
  const equipment = [...new Set(context.equipment ?? environment?.equipment ?? [])].sort();
  return {
    date: context.date,
    minutesAvailable: context.minutesAvailable ?? athlete.weeklySchedule.minutesPerDay ?? 45,
    environmentId: environment?.id ?? null,
    equipment
  };
}

function scheduleSlot(date: string, days: number[]): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const exact = sorted.indexOf(weekday);
  return exact >= 0 ? exact : weekday % Math.max(sorted.length, 1);
}

function selectRoutine(athlete: AthleteState, context: ReturnType<typeof normalizeContext>) {
  const scheduledDays = athlete.weeklySchedule.days ?? [];
  const frequency = Math.max(scheduledDays.length, 1);
  const slot = scheduleSlot(context.date, scheduledDays);

  // Prefer the user's chosen split rotation when a program is set.
  const rotation = athlete.program?.weeklyRoutines;
  if (rotation && rotation.length > 0) {
    const routine = rotation[slot % rotation.length]!;
    return {
      routine,
      rationale: [
        rationale(
          "routine_selection",
          "routine.user_selected_split",
          `Followed the ${athlete.program!.splitId} split: ${routine} day`,
          { splitId: athlete.program!.splitId, scheduleSlot: slot, daysPerWeek: rotation.length }
        )
      ]
    };
  }

  // Fallback: auto-derive the routine from training frequency.
  let routine: Routine;
  if (frequency <= 3) routine = "full_body";
  else if (frequency === 4) routine = slot % 2 === 0 ? "upper" : "lower";
  else routine = (["push", "pull", "legs"] as const)[slot % 3]!;
  return {
    routine,
    rationale: [
      rationale(
        "routine_selection",
        "routine.frequency_split",
        `Selected ${routine} from weekly frequency`,
        {
          frequency,
          scheduleSlot: slot
        }
      )
    ]
  };
}

function weeklyMuscleFrequency(
  athlete: AthleteState,
  muscleId: string,
  muscleGroup: string
): number {
  const scheduledDays = athlete.weeklySchedule.days ?? [];
  const frequency = Math.max(scheduledDays.length, 1);
  const rotation =
    athlete.program?.weeklyRoutines ??
    Array.from({ length: frequency }, (_, slot): Routine => {
      if (frequency <= 3) return "full_body";
      if (frequency === 4) return slot % 2 === 0 ? "upper" : "lower";
      return (["push", "pull", "legs"] as const)[slot % 3]!;
    });
  return Math.max(
    rotation.filter((routine) => routineTargetsMuscle(routine, muscleId, muscleGroup)).length,
    1
  );
}

function allocateMuscles(
  athlete: AthleteState,
  catalog: EngineCatalog,
  rules: RuleSet,
  routine: Routine
): { targets: MuscleTarget[]; rationale: RationaleTag[] } {
  const available = new Set(
    catalog.exercises.flatMap((e) => e.muscles.filter((m) => m.role === "primary").map((m) => m.id))
  );
  const excluded = new Set(athlete.excludedMuscles);
  const candidates = [...available].filter(
    (id) => !excluded.has(id) && routineTargetsMuscle(routine, id, catalog.muscleGroups[id] ?? "")
  );
  const usesTrainingAgeVolume = Boolean(rules.weeklyVolume.byTrainingAge);
  const requestedExercises = usesTrainingAgeVolume
    ? clamp(athlete.sessionPreferences?.exercisesPerSession ?? 5, 2, 8)
    : undefined;
  const volumeMultiplier = usesTrainingAgeVolume
    ? { reduced: 0.8, recommended: 1, increased: 1.2 }[
        athlete.sessionPreferences?.volumeLevel ?? "recommended"
      ]
    : 1;

  const targets = stableSort(
    candidates.map((muscleId) => {
      const trainingAgeRange = rules.weeklyVolume.byTrainingAge?.[athlete.trainingAge];
      const range =
        rules.weeklyVolume.perMuscle[muscleId] ?? trainingAgeRange ?? rules.weeklyVolume.default;
      const completed = athlete.volumeLedger[muscleId] ?? 0;
      const priorityWeight = clamp(athlete.musclePriorities[muscleId] ?? 1, 0.5, 2);
      const fatigueScore = clamp(athlete.perMuscleFatigue[muscleId] ?? 0, 0, 1);
      const baseWeeklyTarget = (range.min + range.max) / 2;
      const specializationMax =
        rules.weeklyVolume.specializationMaxByTrainingAge?.[athlete.trainingAge] ?? range.max;
      const weeklyTarget = usesTrainingAgeVolume
        ? clamp(
            baseWeeklyTarget * priorityWeight * volumeMultiplier,
            range.min,
            priorityWeight > 1 ? specializationMax : range.max
          )
        : baseWeeklyTarget;
      const muscleFrequency = usesTrainingAgeVolume
        ? weeklyMuscleFrequency(athlete, muscleId, catalog.muscleGroups[muscleId] ?? "")
        : Math.max(athlete.weeklySchedule.days?.length ?? 0, 1);
      const raw =
        ((weeklyTarget - completed) / muscleFrequency) *
        (usesTrainingAgeVolume ? 1 : priorityWeight) *
        (1 - fatigueScore * 0.5);
      const normalTargetSets = clamp(
        Math.round(raw),
        usesTrainingAgeVolume ? (raw >= 1 ? MIN_HYPERTROPHY_SETS_PER_EXERCISE : 0) : 1,
        rules.setsPerSessionCap
      );
      const targetSets = athlete.deloadStatus?.recommended
        ? Math.max(
            normalTargetSets > 0 ? 1 : 0,
            Math.ceil(normalTargetSets * rules.adaptivity.recoveryVolumeMultiplier)
          )
        : normalTargetSets;
      return {
        muscleId,
        targetSets,
        priorityWeight,
        fatigueScore,
        rationale: [
          rationale(
            "muscle_allocation",
            "muscle.remaining_volume",
            `Allocated ${targetSets} sets to ${muscleId}`,
            {
              weeklyTarget,
              completedSets: completed,
              priorityWeight,
              fatigueScore,
              ...(usesTrainingAgeVolume ? { volumeMultiplier } : {}),
              ...(usesTrainingAgeVolume ? { muscleFrequency } : {}),
              ...(athlete.deloadStatus?.recommended ? { deload: true } : {})
            }
          )
        ]
      };
    }),
    (target) => {
      const allocationScore = target.targetSets * target.priorityWeight * (1 - target.fatigueScore);
      if (!usesTrainingAgeVolume) return allocationScore;
      const priority = ROUTINE_MUSCLE_PRIORITY[routine] ?? [];
      const rank = priority.indexOf(target.muscleId);
      const movementPriority = rank < 0 ? 0 : priority.length - rank;
      const specializationBonus = target.priorityWeight > 1.25 ? 10_000 : 0;
      return specializationBonus + movementPriority * 100 + allocationScore;
    },
    (target) => target.muscleId
  )
    .filter((target) => target.targetSets > 0)
    .slice(0, routineMuscleCap(routine, requestedExercises));

  return {
    targets,
    rationale: [
      rationale(
        "muscle_allocation",
        "muscle.routine_filter",
        "Filtered muscles for selected routine",
        {
          candidateCount: candidates.length,
          selectedCount: targets.length
        }
      )
    ]
  };
}

function requiredEquipmentAvailable(exercise: ExerciseSeed, equipment: Set<string>): boolean {
  return exercise.equipment.filter((e) => e.required).every((e) => equipment.has(e.id));
}

function injuryPenalty(exercise: ExerciseSeed, athlete: AthleteState): number {
  const injuries = new Set(athlete.injuries.map((i) => i.jointOrMuscle));
  if (exercise.contraindicatedInjuries.some((i) => injuries.has(i)))
    return Number.POSITIVE_INFINITY;
  return exercise.jointStress.reduce(
    (sum, joint) => sum + (injuries.has(joint.id) ? joint.stress : 0),
    0
  );
}

// Weight loadability and a compound bonus so sessions are anchored on popular
// multi-joint staples (squat, bench, pull-up, rows) rather than machine
// isolations. The user can still swap any exercise.
const COMPOUND_BONUS = 0.3;
const USER_EQUIPMENT_PREFERENCE_MUSCLES = new Set([
  "chest",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps"
]);

function primaryMuscle(exercise: ExerciseSeed): string | undefined {
  return exercise.muscles.find((muscle) => muscle.role === "primary")?.id;
}

function userEquipmentPreferenceBonus(exercise: ExerciseSeed): number {
  const muscle = primaryMuscle(exercise);
  if (!muscle || !USER_EQUIPMENT_PREFERENCE_MUSCLES.has(muscle)) return 0;
  const required = new Set(
    exercise.equipment.filter((equipment) => equipment.required).map((equipment) => equipment.id)
  );
  if (required.has("dumbbell") || required.has("cable")) return 2;
  if (required.has("machine") || required.has("smith_machine")) return 1;
  return 0;
}

export function exerciseScore(exercise: ExerciseSeed, athlete: AthleteState): number {
  const stimulus =
    exercise.stimulus.loadability * 0.35 +
    exercise.stimulus.stretchEmphasis * 0.25 +
    exercise.stimulus.stability * 0.15 -
    exercise.stimulus.fatigueCost * 0.1;
  const compoundBonus = exercise.mechanic === "compound" ? COMPOUND_BONUS : 0;
  return stimulus + compoundBonus - injuryPenalty(exercise, athlete);
}

export function userPreferredExerciseScore(exercise: ExerciseSeed, athlete: AthleteState): number {
  return exerciseScore(exercise, athlete) + userEquipmentPreferenceBonus(exercise);
}

function hypertrophyExerciseScore(exercise: ExerciseSeed, athlete: AthleteState): number {
  const stimulus =
    exercise.stimulus.loadability * 0.3 +
    exercise.stimulus.stretchEmphasis * 0.35 +
    exercise.stimulus.stability * 0.15 -
    exercise.stimulus.fatigueCost * 0.1;
  const compoundBonus = exercise.mechanic === "compound" ? COMPOUND_BONUS : 0;
  return (
    stimulus +
    compoundBonus +
    userEquipmentPreferenceBonus(exercise) -
    injuryPenalty(exercise, athlete)
  );
}

function hasCompatibleRepRange(exercise: ExerciseSeed, rules: RuleSet): boolean {
  return rules.repRanges.some(
    (range) =>
      Math.min(exercise.repRange.max, range.max) >= Math.max(exercise.repRange.min, range.min)
  );
}

function selectExercises(
  athlete: AthleteState,
  catalog: EngineCatalog,
  equipment: string[],
  targets: MuscleTarget[],
  rules: RuleSet
): {
  selected: Array<{ exercise: ExerciseSeed; target: MuscleTarget; rationale: RationaleTag[] }>;
  rationale: RationaleTag[];
} {
  const equipmentSet = new Set(equipment);
  const score = rules.weeklyVolume.byTrainingAge ? hypertrophyExerciseScore : exerciseScore;
  const requestedExercises = rules.weeklyVolume.byTrainingAge
    ? clamp(athlete.sessionPreferences?.exercisesPerSession ?? 5, 2, 8)
    : targets.length;
  const candidatesByTarget = targets.map((target) => ({
    target,
    candidates: stableSort(
      catalog.exercises.filter(
        (exercise) =>
          exercise.status === "approved" &&
          exercise.muscles.some((m) => m.id === target.muscleId && m.role === "primary") &&
          hasCompatibleRepRange(exercise, rules) &&
          requiredEquipmentAvailable(exercise, equipmentSet) &&
          Number.isFinite(injuryPenalty(exercise, athlete))
      ),
      (exercise) => score(exercise, athlete),
      (exercise) => exercise.slug
    )
  }));
  const chosen: Array<{
    exercise: ExerciseSeed;
    target: MuscleTarget;
    candidateCount: number;
    patternVariety: boolean;
  }> = [];
  const used = new Set<string>();
  const usesHypertrophyRules = Boolean(rules.weeklyVolume.byTrainingAge);
  const addNext = (entry: (typeof candidatesByTarget)[number]): boolean => {
    const muscleChosen = chosen.filter((item) => item.target.muscleId === entry.target.muscleId);
    const available = entry.candidates.filter((candidate) => !used.has(candidate.slug));
    // Movement-pattern variety: a second exercise for the same muscle should
    // train it through a different pattern (regional hypertrophy — varied
    // exercises grow more of the muscle than repeating one pattern).
    const usedPatterns = new Set(
      muscleChosen
        .map((item) => item.exercise.movementPattern)
        .filter((pattern): pattern is string => Boolean(pattern))
    );
    const varied = usesHypertrophyRules
      ? available.find(
          (candidate) => !candidate.movementPattern || !usedPatterns.has(candidate.movementPattern)
        )
      : undefined;
    const exercise = varied ?? available[0];
    if (!exercise || entry.target.targetSets <= muscleChosen.length) return false;
    used.add(exercise.slug);
    chosen.push({
      exercise,
      target: entry.target,
      candidateCount: entry.candidates.length,
      patternVariety: Boolean(varied && varied !== available[0])
    });
    return true;
  };
  for (const entry of candidatesByTarget) {
    if (chosen.length >= requestedExercises) break;
    addNext(entry);
  }
  while (chosen.length < requestedExercises) {
    let added = false;
    for (const entry of candidatesByTarget) {
      if (chosen.length >= requestedExercises) break;
      added = addNext(entry) || added;
    }
    if (!added) break;
  }
  const selected = chosen.map(
    ({ exercise, target, candidateCount, patternVariety }, chosenIndex) => {
      const usesExercisePreference = Boolean(rules.weeklyVolume.byTrainingAge);
      const sameTarget = chosen.filter((item) => item.target.muscleId === target.muscleId);
      const targetIndex = sameTarget.findIndex((item) => item.exercise.slug === exercise.slug);
      const baseSets = Math.floor(target.targetSets / sameTarget.length);
      const targetSets = Math.min(
        MAX_SETS_PER_EXERCISE,
        baseSets + (targetIndex < target.targetSets % sameTarget.length ? 1 : 0)
      );
      return {
        exercise,
        target: { ...target, targetSets },
        rationale: [
          rationale(
            "exercise_selection",
            "exercise.best_eligible_score",
            `Selected ${exercise.slug}`,
            {
              primaryMuscle: target.muscleId,
              eligibleCandidates: candidateCount,
              score: rounded(score(exercise, athlete)),
              ...(exercise.movementPattern ? { movementPattern: exercise.movementPattern } : {}),
              ...(usesExercisePreference
                ? {
                    exerciseSlot: chosenIndex + 1,
                    requestedExercises
                  }
                : {})
            }
          ),
          ...(patternVariety
            ? [
                rationale(
                  "exercise_selection",
                  "exercise.pattern_variety",
                  `Chose a different movement pattern for extra ${target.muscleId} coverage`,
                  { movementPattern: exercise.movementPattern ?? "unspecified" }
                )
              ]
            : [])
        ]
      };
    }
  );
  return {
    selected,
    rationale: [
      rationale(
        "exercise_selection",
        "exercise.environment_filter",
        "Applied equipment and injury filters",
        {
          availableEquipment: equipment.length,
          selectedExercises: selected.length
        }
      )
    ]
  };
}

function overlapRange(exercise: ExerciseSeed, rules: RuleSet): { min: number; max: number } {
  for (const range of rules.repRanges) {
    const min = Math.max(exercise.repRange.min, range.min);
    const max = Math.min(exercise.repRange.max, range.max);
    if (max >= min) return { min, max };
  }
  return exercise.repRange;
}

/**
 * Dual rep-range periodization within the session: the first exercise for a
 * muscle works the heavier range while fresh (load progression drives the e1RM
 * signal), later exercises for the same muscle shift to the lighter range —
 * hypertrophy is comparable across 5–15 reps when sets are taken close to
 * failure, and lighter accessory work limits axial/joint strain late in the
 * session. Only active for hypertrophy rule sets; 1.0.0 keeps overlapRange.
 */
function repRangeForSlot(
  exercise: ExerciseSeed,
  rules: RuleSet,
  muscleSlot: number
): { min: number; max: number } {
  if (!rules.weeklyVolume.byTrainingAge || rules.repRanges.length < 2) {
    return overlapRange(exercise, rules);
  }
  const ranges = [...rules.repRanges].sort((a, b) => a.min - b.min);
  const preferred = muscleSlot === 0 ? ranges : [...ranges].reverse();
  const overlaps = preferred
    .map((range) => ({
      min: Math.max(exercise.repRange.min, range.min),
      max: Math.min(exercise.repRange.max, range.max)
    }))
    .filter((overlap) => overlap.max >= overlap.min);
  if (overlaps.length === 0) return exercise.repRange;
  // Skip degenerate slivers (e.g. a 10–18 isolation "overlapping" 5–10 at
  // exactly 10) — the exercise is built for the other range.
  const workable = overlaps.find((overlap) => overlap.max - overlap.min >= 2);
  if (workable) return workable;
  return overlaps.reduce((widest, overlap) =>
    overlap.max - overlap.min > widest.max - widest.min ? overlap : widest
  );
}

function targetLoad(
  exercise: ExerciseSeed,
  athlete: AthleteState,
  rules: RuleSet,
  reps: number,
  rir: number
): number | null {
  const e1rm = athlete.perExerciseHistory[exercise.slug]?.e1RMEstimate;
  if (!e1rm) return null;
  const raw = e1rm / (1 + (reps + rir) / rules.adaptivity.e1rmRepsDivisor);
  const increment = rules.adaptivity.minimumLoadIncrement;
  return rounded(Math.round(raw / increment) * increment, 1);
}

function prescribeSets(
  athlete: AthleteState,
  rules: RuleSet,
  selected: ReturnType<typeof selectExercises>["selected"]
): { exercises: PlannedExercise[]; rationale: RationaleTag[] } {
  const muscleSlots = new Map<string, number>();
  const exercises = selected.map(({ exercise, target, rationale: selectionRationale }) => {
    const muscleSlot = muscleSlots.get(target.muscleId) ?? 0;
    muscleSlots.set(target.muscleId, muscleSlot + 1);
    const reps = repRangeForSlot(exercise, rules, muscleSlot);
    const targetRir = athlete.deloadStatus?.recommended
      ? Math.max(rules.rir.max, rules.adaptivity.recoveryMinRir)
      : rounded((rules.rir.min + rules.rir.max) / 2, 1);
    const midpointReps = Math.round((reps.min + reps.max) / 2);
    const sets: PlannedSet[] = Array.from({ length: target.targetSets }, (_, index) => {
      const setTargetRir =
        !athlete.deloadStatus?.recommended &&
        rules.weeklyVolume.byTrainingAge &&
        index === target.targetSets - 1
          ? 0.5
          : targetRir;
      return {
        index: index + 1,
        targetReps: reps,
        targetRir: setTargetRir,
        targetLoad: (() => {
          const load = targetLoad(exercise, athlete, rules, midpointReps, setTargetRir);
          return load && athlete.deloadStatus?.recommended
            ? rounded(load * rules.adaptivity.recoveryLoadMultiplier, 1)
            : load;
        })()
      };
    });
    const ruleRest = rules.restSecondsByMechanic[exercise.mechanic];
    const restSeconds = clamp(
      Math.round(
        (Math.max(exercise.restBand.minSeconds, ruleRest.min) +
          Math.min(exercise.restBand.maxSeconds, ruleRest.max)) /
          2
      ),
      ruleRest.min,
      ruleRest.max
    );
    return {
      exerciseSlug: exercise.slug,
      exerciseName: exercise.name,
      primaryMuscle: target.muscleId,
      mechanic: exercise.mechanic,
      order: 0,
      restSeconds,
      sets,
      rationale: [
        ...selectionRationale,
        rationale("set_rep_load", "prescription.rules_applied", "Applied rep, RIR and rest rules", {
          setCount: sets.length,
          repMin: reps.min,
          repMax: reps.max,
          targetRir,
          restSeconds,
          hasE1RM: sets[0]?.targetLoad !== null,
          ...(rules.weeklyVolume.byTrainingAge
            ? {
                repFocus:
                  reps.min < Math.max(...rules.repRanges.map((range) => range.min))
                    ? "heavy"
                    : "moderate"
              }
            : {})
        })
      ]
    };
  });
  return {
    exercises,
    rationale: [
      rationale("set_rep_load", "prescription.rule_set", `Applied rule set ${rules.version}`, {
        exerciseCount: exercises.length
      })
    ]
  };
}

function exerciseSeconds(exercise: PlannedExercise, includePreparation: boolean): number {
  const preparationSeconds = includePreparation ? (exercise.mechanic === "compound" ? 60 : 30) : 0;
  return (
    preparationSeconds +
    exercise.sets.length * 45 +
    Math.max(exercise.sets.length - 1, 0) * exercise.restSeconds
  );
}

function fitAndOrder(
  exercises: PlannedExercise[],
  targets: MuscleTarget[],
  minutesAvailable: number,
  includePreparation = false
): { exercises: PlannedExercise[]; estimatedDurationMinutes: number; rationale: RationaleTag[] } {
  const priority = new Map(targets.map((target) => [target.muscleId, target.priorityWeight]));
  // Hypertrophy mode trains specialized (priority) muscles first while fresh —
  // exercise-order studies show greater strength/size gains for whatever is
  // performed early in the session.
  const specialized = (exercise: PlannedExercise) =>
    includePreparation && (priority.get(exercise.primaryMuscle) ?? 1) > 1.25;
  const ordered = stableSort(
    exercises,
    (exercise) =>
      (specialized(exercise) ? 1000 : 0) +
      (exercise.mechanic === "compound" ? 100 : 0) +
      exercise.sets.length * 10 +
      (priority.get(exercise.primaryMuscle) ?? 1),
    (exercise) => exercise.exerciseSlug
  );
  const budgetSeconds = minutesAvailable * 60;
  const sessionPreparationSeconds = includePreparation && ordered.length ? 3 * 60 : 0;
  const minimumSetsPerExercise = includePreparation ? MIN_HYPERTROPHY_SETS_PER_EXERCISE : 1;
  const calculateTotal = () =>
    sessionPreparationSeconds +
    ordered.reduce((sum, exercise) => sum + exerciseSeconds(exercise, includePreparation), 0);
  let total = calculateTotal();
  while (total > budgetSeconds) {
    const trimCandidate = [...ordered]
      .reverse()
      .find((exercise) => exercise.sets.length > minimumSetsPerExercise);
    if (trimCandidate) {
      // Preserve the final hard set while trimming earlier volume to fit the session.
      trimCandidate.sets.splice(trimCandidate.sets.length - 2, 1);
    } else if (includePreparation && ordered.length > 1) {
      ordered.pop();
    } else {
      break;
    }
    total = calculateTotal();
  }
  const finalized = ordered
    .filter((exercise) => exercise.sets.length > 0)
    .map((exercise, index) => ({
      ...exercise,
      order: index + 1,
      sets: exercise.sets.map((set, setIndex) => ({ ...set, index: setIndex + 1 }))
    }));
  return {
    exercises: finalized,
    estimatedDurationMinutes: Math.ceil(total / 60),
    rationale: [
      rationale(
        "ordering_time_fitting",
        "ordering.compounds_first",
        "Ordered compounds and high-volume work first",
        {
          exerciseCount: finalized.length
        }
      ),
      rationale(
        "ordering_time_fitting",
        "time_fitting.budget",
        "Trimmed lowest-priority sets to time budget",
        {
          minutesAvailable,
          estimatedDurationMinutes: Math.ceil(total / 60)
        }
      ),
      ...(finalized.some(specialized)
        ? [
            rationale(
              "ordering_time_fitting",
              "ordering.priority_muscle_first",
              "Trained your priority muscles first while fresh",
              { specializedExercises: finalized.filter(specialized).length }
            )
          ]
        : []),
      ...(includePreparation && finalized.length
        ? [
            rationale(
              "ordering_time_fitting",
              "time_fitting.warmup",
              "Reserved warm-up and setup time before working sets",
              { sessionPreparationMinutes: 3, compoundPrepSeconds: 60 }
            )
          ]
        : [])
    ]
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function generateSession(input: EngineInput, observer?: PipelineObserver): SessionPlan {
  const context = normalizeContext(input.athlete, input.context);
  const routineResult = timed(
    "routine_selection",
    observer,
    () => selectRoutine(input.athlete, context),
    (r) => r.rationale
  );
  const allocation = timed(
    "muscle_allocation",
    observer,
    () => allocateMuscles(input.athlete, input.catalog, input.rules, routineResult.routine),
    (r) => r.rationale
  );
  const selection = timed(
    "exercise_selection",
    observer,
    () =>
      selectExercises(
        input.athlete,
        input.catalog,
        context.equipment,
        allocation.targets,
        input.rules
      ),
    (r) => r.rationale
  );
  const prescription = timed(
    "set_rep_load",
    observer,
    () => prescribeSets(input.athlete, input.rules, selection.selected),
    (r) => r.rationale
  );
  const fitted = timed(
    "ordering_time_fitting",
    observer,
    () =>
      fitAndOrder(
        prescription.exercises,
        allocation.targets,
        context.minutesAvailable,
        Boolean(input.rules.weeklyVolume.byTrainingAge)
      ),
    (r) => r.rationale
  );
  const withoutId = {
    contractVersion: CONTRACT_VERSION,
    ruleSetVersion: input.rules.version,
    athleteStateRevision: input.athlete.revision,
    plannedFor: context.date,
    context,
    routine: routineResult.routine,
    estimatedDurationMinutes: fitted.estimatedDurationMinutes,
    muscleTargets: allocation.targets,
    exercises: fitted.exercises,
    rationale: [
      ...routineResult.rationale,
      ...allocation.rationale,
      ...selection.rationale,
      ...prescription.rationale,
      ...fitted.rationale
    ]
  };
  const planId = `plan_${createHash("sha256")
    .update(canonical({ userId: input.athlete.userId, ...withoutId }))
    .digest("hex")
    .slice(0, 24)}`;
  return { planId, ...withoutId };
}
