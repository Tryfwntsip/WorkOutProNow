import type { RationaleTag, Routine, SessionPlan } from "./types.js";
import type { DeloadStatus, NextSetPrediction, ProgressionRecommendation } from "./types.js";

/** E2.10 frozen public API contract. Breaking changes require a new version. */
export const ENGINE_API_CONTRACT_VERSION = "1.0.0" as const;
export const ADAPTIVE_API_CONTRACT_VERSION = "1.1.0" as const;
export const CLIENT_API_CONTRACT_VERSION = "1.2.0" as const;

export interface GeneratePlanResponse {
  sessionId: string;
  plan: SessionPlan;
}

export interface SetLogInput {
  clientSetId: string;
  exerciseSlug: string;
  setIndex: number;
  /** Negative values are valid for assisted exercises. */
  weight: number;
  reps: number;
  rir: number;
  performedAt: string;
}

export interface SetLogResponse {
  setLogId: string;
  accepted: true;
  /** Legacy E2 response shape; E3 uses AdaptiveSetLogResponse. */
  nextSetPrediction: null;
}

export interface CompleteSessionResponse {
  status: "completed";
  /** Legacy E2 response shape; E3 currently recomputes synchronously. */
  recomputeQueued: false;
}

export interface SkipSessionResponse {
  status: "skipped";
  penaltyApplied: false;
}

/** E3 additive response. E2 SessionPlan and its golden contract remain unchanged. */
export interface AdaptiveSetLogResponse {
  setLogId: string;
  accepted: true;
  nextSetPrediction: NextSetPrediction | null;
  progression: ProgressionRecommendation;
}

export interface AdaptiveCompleteSessionResponse {
  status: "completed";
  recomputeQueued: false;
  athleteStateRevision: number;
  deloadStatus: DeloadStatus;
}

export interface AdaptiveSkipSessionResponse {
  status: "skipped";
  penaltyApplied: false;
  redistributedSets: Record<string, number>;
  athleteStateRevision: number;
}

/** E4 additive read contracts consumed by mobile/web clients. */
export interface ExerciseSwapOption {
  exerciseSlug: string;
  exerciseName: string;
  primaryMuscle: string;
  mechanic: "compound" | "isolation";
  requiredEquipment: string[];
  score: number;
  rationale: RationaleTag[];
}

export interface ExerciseSwapResponse {
  sourceExerciseSlug: string;
  options: ExerciseSwapOption[];
}

export interface ExerciseAddOptionsResponse {
  muscleId: string;
  options: ExerciseSwapOption[];
}

export interface ExerciseAddResponse {
  exercise: SessionPlan["exercises"][number];
  plan: SessionPlan;
}

export interface PerformancePoint {
  exerciseSlug: string;
  performedAt: string;
  e1RM: number;
}

export interface ExercisePerformanceSummary {
  exerciseSlug: string;
  firstE1RM: number;
  latestE1RM: number;
  delta: number;
  deltaPct: number;
  points: PerformancePoint[];
}

export interface PerformanceAnalyticsResponse {
  generatedAt: string;
  exercises: ExercisePerformanceSummary[];
}

/** Program / split selection contracts (guided onboarding). */
export interface SplitTemplateView {
  id: string;
  name: string;
  description: string;
  daysPerWeek: number;
  routines: Routine[];
}

export interface ProgramTemplatesResponse {
  daysPerWeek: number;
  options: SplitTemplateView[];
}

export interface TrainingProgramView {
  splitId: string;
  splitName: string;
  daysPerWeek: number;
  trainingDays: number[];
  weeklyRoutines: Routine[];
}

export interface ProgramResponse {
  program: TrainingProgramView | null;
}

export interface WeekPreviewDay {
  date: string;
  weekday: number;
  routine: Routine;
  estimatedDurationMinutes: number;
  plan: SessionPlan;
}

export interface WeekPreviewResponse {
  splitId: string;
  startDate: string;
  days: WeekPreviewDay[];
}
