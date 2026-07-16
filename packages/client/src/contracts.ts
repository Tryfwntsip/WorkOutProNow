import type {
  AdaptiveCompleteSessionResponse,
  AdaptiveSetLogResponse,
  AdaptiveSkipSessionResponse,
  ExerciseAddOptionsResponse,
  ExerciseAddResponse,
  ExerciseSwapResponse,
  GeneratePlanResponse,
  PerformanceAnalyticsResponse,
  ProgramResponse,
  ProgramTemplatesResponse,
  SetLogInput,
  SplitTemplateView,
  TrainingProgramView,
  WeekPreviewDay,
  WeekPreviewResponse
} from "@myoadapt/engine";

export type TrainingAge = "beginner" | "intermediate" | "advanced";
export type InjurySeverity = "mild" | "moderate" | "severe";
export type BiologicalSex = "male" | "female" | "other" | "unspecified";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  status: string;
  subscriptionStatus: string;
}

export interface ProfileInput {
  trainingAge?: TrainingAge;
  recoveryProfile?: number;
  sex?: BiologicalSex;
  heightCm?: number | null;
  weightKg?: number | null;
  birthYear?: number | null;
  weeklySchedule?: { days: number[]; minutesPerDay?: number };
  prefs?: Record<string, unknown>;
  injuries?: Array<{
    jointOrMuscle: string;
    severity?: InjurySeverity;
    constraints?: Record<string, unknown>;
  }>;
  environments?: Array<{ name: string; equipment?: string[] }>;
}

export interface ProfileView {
  userId: string;
  trainingAge: TrainingAge;
  recoveryProfile: number;
  sex: BiologicalSex;
  heightCm: number | null;
  weightKg: number | null;
  birthYear: number | null;
  age: number | null;
  weeklySchedule: { days: number[]; minutesPerDay?: number };
  prefs: Record<string, unknown>;
  injuries: Array<{
    id: string;
    jointOrMuscle: string;
    severity: InjurySeverity;
    constraints: Record<string, unknown>;
  }>;
  environments: Array<{ id: string; name: string; equipment: string[] }>;
}

export interface PlanQuery {
  date: string;
  minutesAvailable?: number;
  environmentId?: string;
  ruleSetVersion?: string;
}

export interface DeloadToolResponse {
  deloadStatus: { recommended: boolean; checkedAt?: string; reason?: string; source?: string };
  athleteStateRevision: number;
}

export interface SpecializationResponse {
  musclePriorities: Record<string, number>;
  athleteStateRevision: number;
}

export type {
  AdaptiveCompleteSessionResponse,
  AdaptiveSetLogResponse,
  AdaptiveSkipSessionResponse,
  ExerciseAddOptionsResponse,
  ExerciseAddResponse,
  ExerciseSwapResponse,
  GeneratePlanResponse,
  PerformanceAnalyticsResponse,
  ProgramResponse,
  ProgramTemplatesResponse,
  SetLogInput,
  SplitTemplateView,
  TrainingProgramView,
  WeekPreviewDay,
  WeekPreviewResponse
};
