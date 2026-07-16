import type { ColumnType, Generated } from "kysely";

// JSON/jsonb column that has a DB default → optional on insert. Selected as the
// parsed object T; written as a JSON string (callers JSON.stringify the value).
type JsonDefaulted<T> = ColumnType<T, string | undefined, string>;
type JsonRequired<T> = ColumnType<T, string, string>;

/**
 * Typed mirror of the E0.3 foundational schema (migration 1720000000000_init).
 * Keep this in sync with migrations — it is the single source of truth for
 * compile-time query types consumed by the services.
 */

export type TrainingAge = "beginner" | "intermediate" | "advanced";
export type AccountStatus = "active" | "suspended" | "deleted";
export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled";
export type InjurySeverity = "mild" | "moderate" | "severe";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  external_auth_id: string;
  email: string;
  status: Generated<AccountStatus>;
  subscription_status: Generated<SubscriptionStatus>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UserSessionsTable {
  id: Generated<string>;
  user_id: string;
  refresh_token_hash: string;
  user_agent: ColumnType<string | null, string | null | undefined, string | null>;
  ip: ColumnType<string | null, string | null | undefined, string | null>;
  expires_at: Timestamp;
  revoked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: Generated<Timestamp>;
}

export interface WeeklySchedule {
  days: number[];
  minutesPerDay?: number;
}

export type BiologicalSex = "male" | "female" | "other" | "unspecified";

export interface ProfilesTable {
  user_id: string;
  training_age: Generated<TrainingAge>;
  recovery_profile: Generated<number>;
  weekly_schedule: JsonDefaulted<WeeklySchedule>;
  prefs: JsonDefaulted<Record<string, unknown>>;
  sex: Generated<BiologicalSex>;
  height_cm: ColumnType<number | null, number | null | undefined, number | null>;
  weight_kg: ColumnType<number | null, number | null | undefined, number | null>;
  birth_year: ColumnType<number | null, number | null | undefined, number | null>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ProfileInjuriesTable {
  id: Generated<string>;
  user_id: string;
  joint_or_muscle: string;
  severity: Generated<InjurySeverity>;
  constraints: JsonDefaulted<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
}

export interface ProfileEnvironmentsTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  equipment: Generated<string[]>;
  created_at: Generated<Timestamp>;
}

// ── E1 — Exercise & Science Database ───────────────────────────

export type ExerciseStatus = "draft" | "in_review" | "approved" | "deprecated";
export type ExerciseMechanic = "compound" | "isolation";
export type MuscleRole = "primary" | "secondary";
export type ReviewDecision = "approve" | "reject" | "request_changes";
export type RuleSetStatus = "draft" | "published" | "archived";

export interface MusclesTable {
  id: string;
  name: string;
  muscle_group: string;
}

export interface EquipmentTable {
  id: string;
  name: string;
  category: string;
}

export interface JointsTable {
  id: string;
  name: string;
}

export interface ExercisesTable {
  id: Generated<string>;
  slug: string;
  name: string;
  parent_exercise_id: ColumnType<string | null, string | null | undefined, string | null>;
  mechanic: ExerciseMechanic;
  movement_pattern: ColumnType<string | null, string | null | undefined, string | null>;
  is_unilateral: Generated<boolean>;
  loadability: number;
  stability: number;
  stretch_emphasis: number;
  fatigue_cost: number;
  rep_min: number;
  rep_max: number;
  rest_min_seconds: number;
  rest_max_seconds: number;
  contraindicated_injuries: Generated<string[]>;
  status: Generated<ExerciseStatus>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ExerciseMusclesTable {
  exercise_id: string;
  muscle_id: string;
  role: MuscleRole;
}

export interface ExerciseEquipmentTable {
  exercise_id: string;
  equipment_id: string;
  required: Generated<boolean>;
}

export interface ExerciseJointStressTable {
  exercise_id: string;
  joint_id: string;
  stress: number;
}

export interface ExerciseReviewsTable {
  id: Generated<string>;
  exercise_id: string;
  reviewer: string;
  decision: ReviewDecision;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_at: Generated<Timestamp>;
}

export interface RuleSetsTable {
  id: Generated<string>;
  version: string;
  status: Generated<RuleSetStatus>;
  // NOT NULL, no default → required on insert (callers JSON.stringify the doc).
  rules: ColumnType<Record<string, unknown>, string, string>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Timestamp>;
  published_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

// ── E2 — Deterministic Engine v1 ────────────────────────────────

export type SessionStatus = "planned" | "in_progress" | "completed" | "skipped";
export type AdaptationTrigger = "set_logged" | "session_completed" | "session_skipped" | "manual";

export interface AthleteStatesTable {
  user_id: string;
  muscle_priorities: JsonDefaulted<Record<string, number>>;
  excluded_muscles: Generated<string[]>;
  per_exercise_history: JsonDefaulted<Record<string, unknown>>;
  per_muscle_fatigue: JsonDefaulted<Record<string, number>>;
  volume_ledger: JsonDefaulted<Record<string, number>>;
  deload_status: JsonDefaulted<Record<string, unknown>>;
  revision: Generated<number>;
  last_recomputed_at: ColumnType<
    Date | null,
    Date | string | null | undefined,
    Date | string | null
  >;
  updated_at: Generated<Timestamp>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  plan_id: string;
  planned_for: ColumnType<string, string, string>;
  environment_id: ColumnType<string | null, string | null | undefined, string | null>;
  status: Generated<SessionStatus>;
  started_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: Generated<Timestamp>;
}

export interface SessionPlansTable {
  plan_id: string;
  session_id: string;
  user_id: string;
  rule_set_version: string;
  athlete_state_revision: number;
  generation_context: JsonRequired<Record<string, unknown>>;
  plan: JsonRequired<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
}

export interface SetLogsTable {
  id: Generated<string>;
  session_id: string;
  client_set_id: string;
  exercise_id: string;
  set_index: number;
  weight: number;
  reps: number;
  rir: number;
  performed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface ExercisePerformanceHistoryTable {
  id: Generated<string>;
  user_id: string;
  exercise_id: string;
  session_id: string;
  set_log_id: string;
  e1rm_estimate: number;
  load: number;
  reps: number;
  rir: number;
  performed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface MuscleFatigueEventsTable {
  id: Generated<string>;
  user_id: string;
  session_id: ColumnType<string | null, string | null | undefined, string | null>;
  muscle_id: string;
  stimulus: number;
  occurred_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface AdaptationEventsTable {
  id: Generated<string>;
  user_id: string;
  session_id: ColumnType<string | null, string | null | undefined, string | null>;
  trigger: AdaptationTrigger;
  athlete_state_revision: number;
  result: JsonRequired<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
}

export interface SessionExerciseSwapsTable {
  id: Generated<string>;
  session_id: string;
  source_exercise_id: string;
  replacement_exercise_id: string;
  created_at: Generated<Timestamp>;
}

export interface Database {
  users: UsersTable;
  user_sessions: UserSessionsTable;
  profiles: ProfilesTable;
  profile_injuries: ProfileInjuriesTable;
  profile_environments: ProfileEnvironmentsTable;
  // E1 — Exercise & Science Database
  muscles: MusclesTable;
  equipment: EquipmentTable;
  joints: JointsTable;
  exercises: ExercisesTable;
  exercise_muscles: ExerciseMusclesTable;
  exercise_equipment: ExerciseEquipmentTable;
  exercise_joint_stress: ExerciseJointStressTable;
  exercise_reviews: ExerciseReviewsTable;
  rule_sets: RuleSetsTable;
  athlete_states: AthleteStatesTable;
  sessions: SessionsTable;
  session_plans: SessionPlansTable;
  set_logs: SetLogsTable;
  exercise_performance_history: ExercisePerformanceHistoryTable;
  muscle_fatigue_events: MuscleFatigueEventsTable;
  adaptation_events: AdaptationEventsTable;
  session_exercise_swaps: SessionExerciseSwapsTable;
}
