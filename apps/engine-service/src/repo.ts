import { getDb, type InjurySeverity, type TrainingAge, type WeeklySchedule } from "@myoadapt/db";
import {
  generateSession,
  userPreferredExerciseScore,
  type AthleteState,
  type EngineCatalog,
  type ExerciseAddOptionsResponse,
  type ExerciseAddResponse,
  type ExerciseSwapResponse,
  type GenerationContext,
  type PerformanceAnalyticsResponse,
  type ProgramTemplatesResponse,
  type RationaleTag,
  type SessionPlan,
  type TrainingProgram,
  type TrainingProgramView,
  type WeekPreviewResponse
} from "@myoadapt/engine";
import { notFound } from "@myoadapt/http-kit";
import {
  latestSemver,
  recommendSplits,
  resolveWeeklyRoutines,
  resolveWeeklyRoutinesForDays,
  ruleSetSchema,
  SPLIT_TEMPLATES,
  type ExerciseSeed,
  type RuleSet
} from "@myoadapt/science";

type JsonMap = Record<string, unknown>;

// Sensible default when a user has not configured equipment yet: a fully
// equipped commercial gym, so generation always yields a usable session.
const DEFAULT_ENVIRONMENT_ID = "default-gym";
const DEFAULT_GYM_EQUIPMENT = [
  "barbell",
  "dumbbell",
  "ez_bar",
  "kettlebell",
  "machine",
  "leg_press",
  "hack_squat",
  "smith_machine",
  "cable",
  "bench",
  "preacher_bench",
  "pullup_bar",
  "dip_bars",
  "bodyweight"
].sort();

function objectValue<T extends JsonMap>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : fallback;
}

export async function resolveUserId(externalAuthId: string, email: string): Promise<string> {
  return getDb()
    .transaction()
    .execute(async (trx) => {
      const user = await trx
        .insertInto("users")
        .values({ external_auth_id: externalAuthId, email })
        .onConflict((oc) =>
          oc.column("external_auth_id").doUpdateSet({ email, updated_at: new Date() })
        )
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("profiles")
        .values({ user_id: user.id })
        .onConflict((oc) => oc.column("user_id").doNothing())
        .execute();
      await trx
        .insertInto("athlete_states")
        .values({ user_id: user.id })
        .onConflict((oc) => oc.column("user_id").doNothing())
        .execute();
      return user.id;
    });
}

export async function loadAthleteState(userId: string): Promise<AthleteState> {
  const db = getDb();
  const [profile, state, injuries, environments] = await Promise.all([
    db
      .selectFrom("profiles")
      .select(["training_age", "recovery_profile", "weekly_schedule", "prefs"])
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("athlete_states")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("profile_injuries")
      .select(["joint_or_muscle", "severity", "constraints"])
      .where("user_id", "=", userId)
      .orderBy("joint_or_muscle")
      .execute(),
    db
      .selectFrom("profile_environments")
      .select(["id", "name", "equipment"])
      .where("user_id", "=", userId)
      .orderBy("name")
      .execute()
  ]);
  const prefs = objectValue<Record<string, unknown>>(profile.prefs, {});
  const program = resolveProgramFromPrefs(prefs, profile.weekly_schedule as WeeklySchedule);
  const rawSessionPreferences = objectValue<Record<string, unknown>>(prefs.sessionPreferences, {});
  const volumeLevel = ["reduced", "recommended", "increased"].includes(
    String(rawSessionPreferences.volumeLevel)
  )
    ? (rawSessionPreferences.volumeLevel as "reduced" | "recommended" | "increased")
    : "recommended";
  const exercisesPerSession = Math.max(
    2,
    Math.min(8, Number(rawSessionPreferences.exercisesPerSession) || 5)
  );
  return {
    userId,
    revision: state.revision,
    trainingAge: profile.training_age as TrainingAge,
    recoveryProfile: profile.recovery_profile,
    weeklySchedule: profile.weekly_schedule as WeeklySchedule,
    ...(program ? { program } : {}),
    sessionPreferences: { volumeLevel, exercisesPerSession },
    musclePriorities: {
      ...objectValue<Record<string, number>>(prefs.musclePriorities, {}),
      ...objectValue<Record<string, number>>(state.muscle_priorities, {})
    },
    excludedMuscles: Array.isArray(prefs.excludedMuscles)
      ? prefs.excludedMuscles.filter((v: unknown): v is string => typeof v === "string").sort()
      : [...state.excluded_muscles].sort(),
    injuries: injuries.map((i) => ({
      jointOrMuscle: i.joint_or_muscle,
      severity: i.severity as InjurySeverity,
      constraints: objectValue(i.constraints, {})
    })),
    // Fall back to a full-gym default when the athlete has not set up any
    // environment yet, so a brand-new user still gets a usable plan instead of
    // an empty session (exercise selection needs available equipment).
    environments:
      environments.length > 0
        ? environments.map((e) => ({ id: e.id, name: e.name, equipment: [...e.equipment].sort() }))
        : [
            {
              id: DEFAULT_ENVIRONMENT_ID,
              name: "Default gym",
              equipment: [...DEFAULT_GYM_EQUIPMENT]
            }
          ],
    perExerciseHistory: objectValue(state.per_exercise_history, {}),
    perMuscleFatigue: objectValue<Record<string, number>>(state.per_muscle_fatigue, {}),
    volumeLedger: objectValue<Record<string, number>>(state.volume_ledger, {}),
    deloadStatus: objectValue(state.deload_status, { recommended: false }),
    ...(state.last_recomputed_at
      ? { lastRecomputedAt: state.last_recomputed_at.toISOString() }
      : {})
  };
}

export async function loadRuleSet(version?: string): Promise<RuleSet> {
  const rows = await getDb()
    .selectFrom("rule_sets")
    .select(["version", "rules"])
    .where("status", "=", "published")
    .$if(Boolean(version), (qb) => qb.where("version", "=", version!))
    .execute();
  if (rows.length === 0) {
    if (version) throw notFound(`Rule set ${version} not found`);
    throw new Error("No published rule set");
  }
  // Default = the highest published semver (robust vs. publish timestamps).
  const latest = latestSemver(rows.map((r) => r.version))!;
  const row = rows.find((r) => r.version === latest)!;
  return ruleSetSchema.parse(row.rules);
}

export async function loadCatalog(): Promise<EngineCatalog> {
  const db = getDb();
  const [exerciseRows, muscles, equipment, jointStress, muscleGroups] = await Promise.all([
    db
      .selectFrom("exercises")
      .selectAll()
      .where("status", "=", "approved")
      .orderBy("slug")
      .execute(),
    db.selectFrom("exercise_muscles").selectAll().execute(),
    db.selectFrom("exercise_equipment").selectAll().execute(),
    db.selectFrom("exercise_joint_stress").selectAll().execute(),
    db.selectFrom("muscles").select(["id", "muscle_group"]).execute()
  ]);
  const exercises: ExerciseSeed[] = exerciseRows.map((exercise) => ({
    slug: exercise.slug,
    name: exercise.name,
    mechanic: exercise.mechanic,
    ...(exercise.movement_pattern ? { movementPattern: exercise.movement_pattern } : {}),
    isUnilateral: exercise.is_unilateral,
    stimulus: {
      loadability: exercise.loadability,
      stability: exercise.stability,
      stretchEmphasis: exercise.stretch_emphasis,
      fatigueCost: exercise.fatigue_cost
    },
    repRange: { min: exercise.rep_min, max: exercise.rep_max },
    restBand: { minSeconds: exercise.rest_min_seconds, maxSeconds: exercise.rest_max_seconds },
    muscles: muscles
      .filter((m) => m.exercise_id === exercise.id)
      .map((m) => ({ id: m.muscle_id, role: m.role })),
    equipment: equipment
      .filter((e) => e.exercise_id === exercise.id)
      .map((e) => ({ id: e.equipment_id, required: e.required })),
    jointStress: jointStress
      .filter((j) => j.exercise_id === exercise.id)
      .map((j) => ({ id: j.joint_id, stress: j.stress })),
    contraindicatedInjuries: exercise.contraindicated_injuries,
    status: exercise.status
  }));
  return {
    exercises,
    muscleGroups: Object.fromEntries(muscleGroups.map((m) => [m.id, m.muscle_group]))
  };
}

export async function persistPlan(
  userId: string,
  plan: SessionPlan,
  context: GenerationContext
): Promise<{ sessionId: string }> {
  return getDb()
    .transaction()
    .execute(async (trx) => {
      await trx
        .insertInto("sessions")
        .values({
          user_id: userId,
          plan_id: plan.planId,
          planned_for: plan.plannedFor,
          // The synthetic default-gym environment is not a persisted row.
          environment_id:
            plan.context.environmentId === DEFAULT_ENVIRONMENT_ID
              ? null
              : plan.context.environmentId
        })
        .onConflict((oc) => oc.column("plan_id").doNothing())
        .execute();
      const session = await trx
        .selectFrom("sessions")
        .select("id")
        .where("plan_id", "=", plan.planId)
        .where("user_id", "=", userId)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("session_plans")
        .values({
          plan_id: plan.planId,
          session_id: session.id,
          user_id: userId,
          rule_set_version: plan.ruleSetVersion,
          athlete_state_revision: plan.athleteStateRevision,
          generation_context: JSON.stringify(context),
          plan: JSON.stringify(plan)
        })
        .onConflict((oc) => oc.column("plan_id").doNothing())
        .execute();
      return { sessionId: session.id };
    });
}

export async function updateAthleteState(
  userId: string,
  patch: Partial<{
    musclePriorities: Record<string, number>;
    excludedMuscles: string[];
    perExerciseHistory: Record<string, unknown>;
    perMuscleFatigue: Record<string, number>;
    volumeLedger: Record<string, number>;
    deloadStatus: unknown;
    lastRecomputedAt: string;
  }>
): Promise<number> {
  const row = await getDb()
    .updateTable("athlete_states")
    .set((eb) => ({
      revision: eb("revision", "+", 1),
      ...(patch.musclePriorities
        ? { muscle_priorities: JSON.stringify(patch.musclePriorities) }
        : {}),
      ...(patch.excludedMuscles ? { excluded_muscles: [...patch.excludedMuscles].sort() } : {}),
      ...(patch.perExerciseHistory
        ? { per_exercise_history: JSON.stringify(patch.perExerciseHistory) }
        : {}),
      ...(patch.perMuscleFatigue
        ? { per_muscle_fatigue: JSON.stringify(patch.perMuscleFatigue) }
        : {}),
      ...(patch.volumeLedger ? { volume_ledger: JSON.stringify(patch.volumeLedger) } : {}),
      ...(patch.deloadStatus ? { deload_status: JSON.stringify(patch.deloadStatus) } : {}),
      ...(patch.lastRecomputedAt ? { last_recomputed_at: patch.lastRecomputedAt } : {})
    }))
    .where("user_id", "=", userId)
    .returning("revision")
    .executeTakeFirstOrThrow();
  return row.revision;
}

export async function logSet(
  userId: string,
  sessionId: string,
  input: {
    clientSetId: string;
    exerciseSlug: string;
    setIndex: number;
    weight: number;
    reps: number;
    rir: number;
    performedAt: string;
  }
): Promise<string | undefined> {
  const db = getDb();
  const session = await db
    .selectFrom("sessions")
    .select("id")
    .where("sessions.id", "=", sessionId)
    .where("sessions.user_id", "=", userId)
    .executeTakeFirst();
  if (!session) return undefined;
  const exercise = await db
    .selectFrom("exercises")
    .select("id")
    .where("slug", "=", input.exerciseSlug)
    .executeTakeFirst();
  if (!exercise) return undefined;
  await db
    .updateTable("sessions")
    .set({ status: "in_progress", started_at: new Date() })
    .where("id", "=", session.id)
    .where("status", "=", "planned")
    .execute();
  await db
    .insertInto("set_logs")
    .values({
      session_id: session.id,
      client_set_id: input.clientSetId,
      exercise_id: exercise.id,
      set_index: input.setIndex,
      weight: input.weight,
      reps: input.reps,
      rir: input.rir,
      performed_at: input.performedAt
    })
    .onConflict((oc) => oc.columns(["session_id", "client_set_id"]).doNothing())
    .execute();
  const log = await db
    .selectFrom("set_logs")
    .select("id")
    .where("session_id", "=", session.id)
    .where("client_set_id", "=", input.clientSetId)
    .executeTakeFirst();
  return log?.id;
}

export async function finishSession(
  userId: string,
  sessionId: string,
  status: "completed" | "skipped"
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .updateTable("sessions")
    .set({ status, completed_at: new Date() })
    .where("id", "=", sessionId)
    .where("user_id", "=", userId)
    .where("status", "not in", ["completed", "skipped"])
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) > 0) return true;
  const existing = await db
    .selectFrom("sessions")
    .select("status")
    .where("id", "=", sessionId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return existing?.status === status;
}

function swapRationale(code: string, message: string, facts: RationaleTag["facts"]): RationaleTag {
  return { stage: "exercise_selection", code, message, facts };
}

export async function loadExerciseSwaps(
  userId: string,
  exerciseSlug: string,
  environmentId?: string
): Promise<ExerciseSwapResponse | undefined> {
  const [athlete, catalog] = await Promise.all([loadAthleteState(userId), loadCatalog()]);
  const source = catalog.exercises.find((exercise) => exercise.slug === exerciseSlug);
  if (!source) return undefined;
  const primaryMuscle = source.muscles.find((muscle) => muscle.role === "primary")?.id;
  if (!primaryMuscle) return { sourceExerciseSlug: exerciseSlug, options: [] };
  const environment = environmentId
    ? athlete.environments.find((item) => item.id === environmentId)
    : athlete.environments[0];
  const available = new Set(environment?.equipment ?? []);
  const injuries = new Set(athlete.injuries.map((injury) => injury.jointOrMuscle));
  const options = catalog.exercises
    .filter(
      (candidate) =>
        candidate.slug !== source.slug &&
        candidate.muscles.some(
          (muscle) => muscle.id === primaryMuscle && muscle.role === "primary"
        ) &&
        candidate.equipment
          .filter((equipment) => equipment.required)
          .every((equipment) => available.has(equipment.id)) &&
        !candidate.contraindicatedInjuries.some((injury) => injuries.has(injury))
    )
    .map((candidate) => {
      // Same scoring as plan generation so swap suggestions favour the same
      // popular compound staples.
      const score = Math.round(userPreferredExerciseScore(candidate, athlete) * 1000) / 1000;
      return {
        exerciseSlug: candidate.slug,
        exerciseName: candidate.name,
        primaryMuscle,
        mechanic: candidate.mechanic,
        requiredEquipment: candidate.equipment
          .filter((equipment) => equipment.required)
          .map((equipment) => equipment.id)
          .sort(),
        score,
        rationale: [
          swapRationale(
            "swap.same_primary_muscle",
            `Preserves the ${primaryMuscle} training target`,
            { primaryMuscle }
          ),
          swapRationale(
            "swap.environment_and_injury_safe",
            "Available in the selected environment and compatible with recorded injuries",
            {
              environmentId: environment?.id ?? "none",
              requiredEquipment: candidate.equipment.length
            }
          )
        ]
      };
    })
    .sort((a, b) => b.score - a.score || a.exerciseSlug.localeCompare(b.exerciseSlug));
  return { sourceExerciseSlug: exerciseSlug, options };
}

export async function loadExerciseAddOptions(
  userId: string,
  muscleId: string,
  environmentId?: string
): Promise<ExerciseAddOptionsResponse> {
  const [athlete, catalog] = await Promise.all([loadAthleteState(userId), loadCatalog()]);
  const environment = environmentId
    ? athlete.environments.find((item) => item.id === environmentId)
    : athlete.environments[0];
  const available = new Set(environment?.equipment ?? []);
  const injuries = new Set(athlete.injuries.map((injury) => injury.jointOrMuscle));
  const options = catalog.exercises
    .filter(
      (candidate) =>
        candidate.muscles.some((muscle) => muscle.id === muscleId && muscle.role === "primary") &&
        candidate.equipment
          .filter((equipment) => equipment.required)
          .every((equipment) => available.has(equipment.id)) &&
        !candidate.contraindicatedInjuries.some((injury) => injuries.has(injury))
    )
    .map((candidate) => ({
      exerciseSlug: candidate.slug,
      exerciseName: candidate.name,
      primaryMuscle: muscleId,
      mechanic: candidate.mechanic,
      requiredEquipment: candidate.equipment
        .filter((equipment) => equipment.required)
        .map((equipment) => equipment.id)
        .sort(),
      score: Math.round(userPreferredExerciseScore(candidate, athlete) * 1000) / 1000,
      rationale: [
        swapRationale("add.requested_muscle", `Adds targeted work for ${muscleId}`, { muscleId }),
        swapRationale(
          "add.environment_and_injury_safe",
          "Available in the selected environment and compatible with recorded injuries",
          {
            environmentId: environment?.id ?? "none",
            requiredEquipment: candidate.equipment.length
          }
        )
      ]
    }))
    .sort((a, b) => b.score - a.score || a.exerciseSlug.localeCompare(b.exerciseSlug));
  return { muscleId, options };
}

export async function addExerciseToSession(
  userId: string,
  sessionId: string,
  exerciseSlug: string
): Promise<ExerciseAddResponse | undefined> {
  const db = getDb();
  const session = await db
    .selectFrom("sessions")
    .innerJoin("session_plans", "session_plans.session_id", "sessions.id")
    .select(["sessions.environment_id", "session_plans.plan"])
    .where("sessions.id", "=", sessionId)
    .where("sessions.user_id", "=", userId)
    .executeTakeFirst();
  if (!session) return undefined;
  const plan = session.plan as unknown as SessionPlan;
  if (
    plan.exercises.length >= 8 ||
    plan.exercises.some((item) => item.exerciseSlug === exerciseSlug)
  )
    return undefined;

  const catalog = await loadCatalog();
  const exercise = catalog.exercises.find((candidate) => candidate.slug === exerciseSlug);
  const muscleId = exercise?.muscles.find((muscle) => muscle.role === "primary")?.id;
  if (!exercise || !muscleId) return undefined;
  const valid = await loadExerciseAddOptions(userId, muscleId, session.environment_id ?? undefined);
  if (!valid.options.some((option) => option.exerciseSlug === exerciseSlug)) return undefined;

  const repMin = Math.max(5, exercise.repRange.min);
  const repMax = Math.min(15, exercise.repRange.max);
  const added = {
    exerciseSlug: exercise.slug,
    exerciseName: exercise.name,
    primaryMuscle: muscleId,
    mechanic: exercise.mechanic,
    order: plan.exercises.length + 1,
    restSeconds: exercise.mechanic === "compound" ? 165 : 105,
    sets: Array.from({ length: 3 }, (_, index) => ({
      index: index + 1,
      targetReps: { min: repMin, max: Math.max(repMin, repMax) },
      targetRir: index === 2 ? 0.5 : 1,
      targetLoad: null
    })),
    rationale: [
      swapRationale("add.user_selected", `Added ${exercise.name} for ${muscleId}`, {
        primaryMuscle: muscleId,
        setCount: 3
      })
    ]
  };
  plan.exercises.push(added);
  plan.estimatedDurationMinutes += Math.ceil(
    (3 * 45 + 2 * added.restSeconds + (added.mechanic === "compound" ? 60 : 30)) / 60
  );
  const muscleTarget = plan.muscleTargets.find((target) => target.muscleId === muscleId);
  if (muscleTarget) muscleTarget.targetSets += 3;

  await db
    .updateTable("session_plans")
    .set({ plan: JSON.stringify(plan) })
    .where("session_id", "=", sessionId)
    .where("user_id", "=", userId)
    .execute();
  return { exercise: added, plan };
}

export async function loadPerformanceAnalytics(
  userId: string,
  exerciseSlug?: string
): Promise<PerformanceAnalyticsResponse> {
  let query = getDb()
    .selectFrom("exercise_performance_history")
    .innerJoin("exercises", "exercises.id", "exercise_performance_history.exercise_id")
    .select([
      "exercises.slug as exercise_slug",
      "exercise_performance_history.e1rm_estimate",
      "exercise_performance_history.performed_at"
    ])
    .where("exercise_performance_history.user_id", "=", userId)
    .orderBy("exercise_performance_history.performed_at");
  if (exerciseSlug) query = query.where("exercises.slug", "=", exerciseSlug);
  const rows = await query.execute();
  const byExercise = new Map<string, typeof rows>();
  for (const row of rows) {
    const values = byExercise.get(row.exercise_slug) ?? [];
    values.push(row);
    byExercise.set(row.exercise_slug, values);
  }
  const exercises = [...byExercise.entries()].map(([slug, values]) => {
    const points = values.map((value) => ({
      exerciseSlug: slug,
      performedAt: value.performed_at.toISOString(),
      e1RM: value.e1rm_estimate
    }));
    const firstE1RM = points[0]!.e1RM;
    const latestE1RM = points.at(-1)!.e1RM;
    const delta = Math.round((latestE1RM - firstE1RM) * 100) / 100;
    return {
      exerciseSlug: slug,
      firstE1RM,
      latestE1RM,
      delta,
      deltaPct: firstE1RM === 0 ? 0 : Math.round((delta / firstE1RM) * 10000) / 100,
      points
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    exercises: exercises.sort(
      (a, b) => b.deltaPct - a.deltaPct || a.exerciseSlug.localeCompare(b.exerciseSlug)
    )
  };
}

export async function persistExerciseSwap(
  userId: string,
  sessionId: string,
  sourceExerciseSlug: string,
  replacementExerciseSlug: string
): Promise<boolean> {
  const db = getDb();
  const session = await db
    .selectFrom("sessions")
    .innerJoin("session_plans", "session_plans.session_id", "sessions.id")
    .select(["sessions.id", "sessions.environment_id", "session_plans.plan"])
    .where("sessions.id", "=", sessionId)
    .where("sessions.user_id", "=", userId)
    .executeTakeFirst();
  if (!session) return false;
  const plan = session.plan as unknown as SessionPlan;
  if (!plan.exercises.some((exercise) => exercise.exerciseSlug === sourceExerciseSlug))
    return false;
  const valid = await loadExerciseSwaps(
    userId,
    sourceExerciseSlug,
    session.environment_id ?? undefined
  );
  if (!valid?.options.some((option) => option.exerciseSlug === replacementExerciseSlug))
    return false;
  const [source, replacement] = await Promise.all([
    db
      .selectFrom("exercises")
      .select("id")
      .where("slug", "=", sourceExerciseSlug)
      .executeTakeFirst(),
    db
      .selectFrom("exercises")
      .select("id")
      .where("slug", "=", replacementExerciseSlug)
      .executeTakeFirst()
  ]);
  if (!source || !replacement) return false;
  await db
    .insertInto("session_exercise_swaps")
    .values({
      session_id: sessionId,
      source_exercise_id: source.id,
      replacement_exercise_id: replacement.id
    })
    .onConflict((oc) =>
      oc.columns(["session_id", "source_exercise_id"]).doUpdateSet({
        replacement_exercise_id: replacement.id,
        created_at: new Date()
      })
    )
    .execute();
  return true;
}

// ── Program / split selection (guided onboarding) ──────────────

/** Canonical weekday spread (1=Mon..6=Sat) for a chosen weekly frequency. */
function chooseTrainingDays(daysPerWeek: number): number[] {
  const spreads: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6]
  };
  return spreads[daysPerWeek] ?? [1, 3, 5];
}

/** Resolve the persisted prefs.program ({ splitId, daysPerWeek }) to a full program. */
function resolveProgramFromPrefs(
  prefs: Record<string, unknown>,
  weeklySchedule?: WeeklySchedule
): TrainingProgram | undefined {
  const raw = objectValue<Record<string, unknown>>(prefs.program, {});
  const splitId = typeof raw.splitId === "string" ? raw.splitId : undefined;
  const daysPerWeek = typeof raw.daysPerWeek === "number" ? raw.daysPerWeek : undefined;
  if (!splitId || !daysPerWeek) return undefined;
  const weeklyRoutines = resolveWeeklyRoutinesForDays(
    splitId,
    daysPerWeek,
    weeklySchedule?.days ?? []
  );
  if (!weeklyRoutines) return undefined;
  return { splitId, daysPerWeek, weeklyRoutines };
}

/** Split templates that fit a chosen weekly training frequency. */
export function listProgramTemplates(daysPerWeek: number): ProgramTemplatesResponse {
  const options = recommendSplits(daysPerWeek).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    daysPerWeek,
    routines: template.sessionsByFrequency[daysPerWeek]!
  }));
  return { daysPerWeek, options };
}

function programView(
  splitId: string,
  daysPerWeek: number,
  trainingDays: number[]
): TrainingProgramView | null {
  const weeklyRoutines = resolveWeeklyRoutinesForDays(splitId, daysPerWeek, trainingDays);
  if (!weeklyRoutines) return null;
  const splitName = SPLIT_TEMPLATES.find((t) => t.id === splitId)?.name ?? splitId;
  return { splitId, splitName, daysPerWeek, trainingDays, weeklyRoutines };
}

function sanitizeTrainingDays(daysPerWeek: number, requested: number[] | undefined): number[] {
  if (!requested) return chooseTrainingDays(daysPerWeek);
  const unique = [
    ...new Set(requested.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  ].sort((a, b) => a - b);
  // Only honor a custom selection that matches the split's day count.
  return unique.length === daysPerWeek ? unique : chooseTrainingDays(daysPerWeek);
}

/** Persist a chosen split + frequency, setting the training-day schedule. */
export async function setProgram(
  userId: string,
  daysPerWeek: number,
  splitId: string,
  requestedDays?: number[]
): Promise<TrainingProgramView | null> {
  const weeklyRoutines = resolveWeeklyRoutines(splitId, daysPerWeek);
  if (!weeklyRoutines) return null;
  const trainingDays = sanitizeTrainingDays(daysPerWeek, requestedDays);
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    const profile = await trx
      .selectFrom("profiles")
      .select(["prefs", "weekly_schedule"])
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();
    const prefs = objectValue<Record<string, unknown>>(profile.prefs, {});
    const schedule = objectValue<Record<string, unknown>>(profile.weekly_schedule, {});
    await trx
      .updateTable("profiles")
      // updated_at is maintained by the profiles BEFORE UPDATE trigger.
      .set({
        prefs: JSON.stringify({
          ...prefs,
          program: { splitId, daysPerWeek },
          sessionPreferences: {
            volumeLevel: "recommended",
            exercisesPerSession: 5,
            ...objectValue<Record<string, unknown>>(prefs.sessionPreferences, {})
          }
        }),
        weekly_schedule: JSON.stringify({
          ...schedule,
          days: trainingDays,
          minutesPerDay: Math.max(Number(schedule.minutesPerDay) || 45, 45)
        })
      })
      .where("user_id", "=", userId)
      .execute();
  });
  return programView(splitId, daysPerWeek, trainingDays);
}

/** Read the athlete's currently selected program, or null if none set. */
export async function loadProgram(userId: string): Promise<TrainingProgramView | null> {
  const profile = await getDb()
    .selectFrom("profiles")
    .select(["prefs", "weekly_schedule"])
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!profile) return null;
  const prefs = objectValue<Record<string, unknown>>(profile.prefs, {});
  const schedule = objectValue<Record<string, unknown>>(profile.weekly_schedule, {});
  const trainingDays = Array.isArray(schedule.days)
    ? schedule.days.filter((d): d is number => typeof d === "number")
    : [];
  const program = resolveProgramFromPrefs(prefs, { days: trainingDays });
  if (!program) return null;
  return programView(program.splitId, program.daysPerWeek, trainingDays);
}

/** Remove the athlete's selected program (clears prefs.program). */
export async function clearProgram(userId: string): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    const profile = await trx
      .selectFrom("profiles")
      .select("prefs")
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!profile) return;
    const prefs = objectValue<Record<string, unknown>>(profile.prefs, {});
    delete prefs.program;
    await trx
      .updateTable("profiles")
      .set({ prefs: JSON.stringify(prefs) })
      .where("user_id", "=", userId)
      .execute();
  });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Generate a read-only preview of the whole training week — the complete
 * program a personal trainer would hand over. Sessions are NOT persisted here;
 * the real session is created on demand via /session/plan when the user trains.
 */
export async function generateWeekPreview(
  userId: string,
  startDate: string
): Promise<WeekPreviewResponse> {
  const [athlete, catalog, rules] = await Promise.all([
    loadAthleteState(userId),
    loadCatalog(),
    loadRuleSet()
  ]);
  const trainingDays = new Set(athlete.weeklySchedule.days ?? []);
  const minutes = Math.max(athlete.weeklySchedule.minutesPerDay ?? 45, 45);
  const environmentId = athlete.environments[0]?.id;
  const days: WeekPreviewResponse["days"] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(startDate, offset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!trainingDays.has(weekday)) continue;
    const plan = generateSession({
      athlete,
      catalog,
      rules,
      context: { date, minutesAvailable: minutes, ...(environmentId ? { environmentId } : {}) }
    });
    days.push({
      date,
      weekday,
      routine: plan.routine,
      estimatedDurationMinutes: plan.estimatedDurationMinutes,
      plan
    });
  }
  return { splitId: athlete.program?.splitId ?? "auto", startDate, days };
}
