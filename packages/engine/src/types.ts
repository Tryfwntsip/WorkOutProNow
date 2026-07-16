import type { ExerciseSeed, Routine, RuleSet } from "@myoadapt/science";

export type { Routine };
export type TrainingAge = "beginner" | "intermediate" | "advanced";
export type PipelineStage =
  | "routine_selection"
  | "muscle_allocation"
  | "exercise_selection"
  | "set_rep_load"
  | "ordering_time_fitting";

export interface EngineStage<Input, Output> {
  readonly name: PipelineStage;
  run(input: Input): Output;
}

export interface AthleteState {
  userId: string;
  revision: number;
  trainingAge: TrainingAge;
  recoveryProfile: number;
  weeklySchedule: { days: number[]; minutesPerDay?: number };
  musclePriorities: Record<string, number>;
  excludedMuscles: string[];
  injuries: Array<{
    jointOrMuscle: string;
    severity: "mild" | "moderate" | "severe";
    constraints: Record<string, unknown>;
  }>;
  environments: Array<{ id: string; name: string; equipment: string[] }>;
  perExerciseHistory: Record<string, ExerciseHistoryEntry>;
  perMuscleFatigue: Record<string, number>;
  volumeLedger: Record<string, number>;
  deloadStatus?: DeloadStatus;
  lastRecomputedAt?: string;
  sessionPreferences?: SessionPreferences;
  /**
   * User-selected training program. When present, the engine follows the
   * chosen split's weekly routine rotation instead of auto-deriving the routine
   * from frequency. Resolved by the service from the science split templates.
   */
  program?: TrainingProgram;
}

export interface SessionPreferences {
  volumeLevel: "reduced" | "recommended" | "increased";
  exercisesPerSession: number;
}

export interface TrainingProgram {
  splitId: string;
  daysPerWeek: number;
  weeklyRoutines: Routine[];
}

export interface ExerciseHistoryEntry {
  e1RMEstimate?: number;
  repPerformanceAdjustment?: number;
  lastLoads?: number[];
  recentE1RMs?: number[];
  lastPerformedAt?: string;
}

export interface PerformanceSet {
  exerciseSlug: string;
  setIndex: number;
  weight: number;
  reps: number;
  rir: number;
  performedAt: string;
}

export interface NextSetPrediction {
  exerciseSlug: string;
  predictedReps: number;
  recommendedLoad: number | null;
  confidence: "low" | "medium" | "high";
  rationale: string;
}

export interface ProgressionRecommendation {
  exerciseSlug: string;
  action: "increase_reps" | "increase_load" | "hold" | "reduce_load";
  loadDelta: number;
  repDelta?: number;
  rationale: string;
}

export interface DeloadStatus {
  recommended: boolean;
  checkedAt?: string;
  reason?: string;
  source?: "automatic" | "manual";
}

export interface GenerationContext {
  /** ISO calendar date. It is part of the deterministic input. */
  date: string;
  minutesAvailable?: number;
  environmentId?: string;
  equipment?: string[];
}

export interface EngineCatalog {
  exercises: ExerciseSeed[];
  muscleGroups: Record<string, string>;
}

export interface RationaleTag {
  stage: PipelineStage;
  code: string;
  message: string;
  facts: Record<string, string | number | boolean>;
}

export interface MuscleTarget {
  muscleId: string;
  targetSets: number;
  priorityWeight: number;
  fatigueScore: number;
  rationale: RationaleTag[];
}

export interface PlannedSet {
  index: number;
  targetReps: { min: number; max: number };
  targetRir: number;
  targetLoad: number | null;
}

export interface PlannedExercise {
  exerciseSlug: string;
  exerciseName: string;
  primaryMuscle: string;
  mechanic: "compound" | "isolation";
  order: number;
  restSeconds: number;
  sets: PlannedSet[];
  rationale: RationaleTag[];
}

export interface SessionPlan {
  planId: string;
  contractVersion: "1.0.0";
  ruleSetVersion: string;
  athleteStateRevision: number;
  plannedFor: string;
  context: Required<Pick<GenerationContext, "date" | "minutesAvailable">> & {
    environmentId: string | null;
    equipment: string[];
  };
  routine: Routine;
  estimatedDurationMinutes: number;
  muscleTargets: MuscleTarget[];
  exercises: PlannedExercise[];
  rationale: RationaleTag[];
}

export interface EngineInput {
  athlete: AthleteState;
  context: GenerationContext;
  catalog: EngineCatalog;
  rules: RuleSet;
}

export interface PipelineObserver {
  stageCompleted?(stage: PipelineStage, durationMs: number, rationaleCount: number): void;
}
