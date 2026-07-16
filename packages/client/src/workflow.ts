import type { PlannedExercise, PlannedSet, RationaleTag, SessionPlan } from "@myoadapt/engine";

export interface SessionDraft {
  sessionId: string;
  plan: SessionPlan;
  adjustments: string[];
}

export function createSessionDraft(sessionId: string, plan: SessionPlan): SessionDraft {
  return { sessionId, plan: structuredClone(plan), adjustments: [] };
}

export function adjustPlannedSet(
  draft: SessionDraft,
  exerciseSlug: string,
  setIndex: number,
  patch: Partial<Pick<PlannedSet, "targetLoad" | "targetReps" | "targetRir">>
): SessionDraft {
  const next = structuredClone(draft);
  const exercise = next.plan.exercises.find((item) => item.exerciseSlug === exerciseSlug);
  const set = exercise?.sets.find((item) => item.index === setIndex);
  if (!exercise || !set) return next;
  Object.assign(set, patch);
  next.adjustments.push(`Adjusted ${exercise.exerciseName} set ${setIndex}`);
  return next;
}

export function removePlannedSet(
  draft: SessionDraft,
  exerciseSlug: string,
  setIndex: number
): SessionDraft {
  const next = structuredClone(draft);
  const exercise = next.plan.exercises.find((item) => item.exerciseSlug === exerciseSlug);
  if (!exercise) return next;
  exercise.sets = exercise.sets
    .filter((item) => item.index !== setIndex)
    .map((item, index) => ({ ...item, index: index + 1 }));
  next.adjustments.push(`Removed ${exercise.exerciseName} set ${setIndex}`);
  return next;
}

export function swapExercise(
  draft: SessionDraft,
  sourceSlug: string,
  replacement: Pick<PlannedExercise, "exerciseSlug" | "exerciseName" | "mechanic">
): SessionDraft {
  const next = structuredClone(draft);
  const exercise = next.plan.exercises.find((item) => item.exerciseSlug === sourceSlug);
  if (!exercise) return next;
  const previousName = exercise.exerciseName;
  exercise.exerciseSlug = replacement.exerciseSlug;
  exercise.exerciseName = replacement.exerciseName;
  exercise.mechanic = replacement.mechanic;
  next.adjustments.push(`Swapped ${previousName} for ${replacement.exerciseName}`);
  return next;
}

export function explainExercise(plan: SessionPlan, exerciseSlug: string): RationaleTag[] {
  return plan.exercises.find((exercise) => exercise.exerciseSlug === exerciseSlug)?.rationale ?? [];
}
