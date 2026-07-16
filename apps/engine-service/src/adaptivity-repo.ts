import { getDb, type AdaptationTrigger } from "@myoadapt/db";
import {
  estimateE1RM,
  applySpecialization,
  predictNextSet,
  recommendProgression,
  recomputeAfterSession,
  recomputeFatigue,
  skippedSessionRedistribution,
  updateExerciseHistory,
  type AdaptiveCompleteSessionResponse,
  type AdaptiveSetLogResponse,
  type AdaptiveSkipSessionResponse,
  type PerformanceSet,
  type SessionPlan
} from "@myoadapt/engine";
import { loadAthleteState, loadCatalog, loadRuleSet, updateAthleteState } from "./repo.js";

interface SessionContext {
  plan: SessionPlan;
  sets: Array<PerformanceSet & { setLogId: string }>;
}

async function loadSessionContext(
  userId: string,
  sessionId: string
): Promise<SessionContext | undefined> {
  const db = getDb();
  const row = await db
    .selectFrom("sessions")
    .innerJoin("session_plans", "session_plans.session_id", "sessions.id")
    .select("session_plans.plan")
    .where("sessions.id", "=", sessionId)
    .where("sessions.user_id", "=", userId)
    .executeTakeFirst();
  if (!row) return undefined;
  const logs = await db
    .selectFrom("set_logs")
    .innerJoin("exercises", "exercises.id", "set_logs.exercise_id")
    .select([
      "set_logs.id as set_log_id",
      "exercises.slug as exercise_slug",
      "set_logs.set_index",
      "set_logs.weight",
      "set_logs.reps",
      "set_logs.rir",
      "set_logs.performed_at"
    ])
    .where("set_logs.session_id", "=", sessionId)
    .orderBy("set_logs.performed_at")
    .orderBy("set_logs.set_index")
    .execute();
  return {
    plan: row.plan as unknown as SessionPlan,
    sets: logs.map((log) => ({
      setLogId: log.set_log_id,
      exerciseSlug: log.exercise_slug,
      setIndex: log.set_index,
      weight: log.weight,
      reps: log.reps,
      rir: log.rir,
      performedAt: log.performed_at.toISOString()
    }))
  };
}

async function loadRecentSets(userId: string, asOf: string): Promise<PerformanceSet[]> {
  const since = new Date(Date.parse(asOf) - 7 * 24 * 60 * 60 * 1000);
  const logs = await getDb()
    .selectFrom("set_logs")
    .innerJoin("sessions", "sessions.id", "set_logs.session_id")
    .innerJoin("exercises", "exercises.id", "set_logs.exercise_id")
    .select([
      "exercises.slug as exercise_slug",
      "set_logs.set_index",
      "set_logs.weight",
      "set_logs.reps",
      "set_logs.rir",
      "set_logs.performed_at"
    ])
    .where("sessions.user_id", "=", userId)
    .where("set_logs.performed_at", ">=", since)
    .where("set_logs.performed_at", "<=", new Date(asOf))
    .orderBy("set_logs.performed_at")
    .execute();
  return logs.map((log) => ({
    exerciseSlug: log.exercise_slug,
    setIndex: log.set_index,
    weight: log.weight,
    reps: log.reps,
    rir: log.rir,
    performedAt: log.performed_at.toISOString()
  }));
}

async function loadPlannedExerciseSlug(
  sessionId: string,
  performedExerciseSlug: string
): Promise<string> {
  const swap = await getDb()
    .selectFrom("session_exercise_swaps")
    .innerJoin(
      "exercises as replacement",
      "replacement.id",
      "session_exercise_swaps.replacement_exercise_id"
    )
    .innerJoin("exercises as source", "source.id", "session_exercise_swaps.source_exercise_id")
    .select("source.slug as source_slug")
    .where("session_exercise_swaps.session_id", "=", sessionId)
    .where("replacement.slug", "=", performedExerciseSlug)
    .executeTakeFirst();
  return swap?.source_slug ?? performedExerciseSlug;
}

async function writeAdaptationEvent(input: {
  userId: string;
  sessionId: string;
  trigger: AdaptationTrigger;
  revision: number;
  result: Record<string, unknown>;
}): Promise<void> {
  await getDb()
    .insertInto("adaptation_events")
    .values({
      user_id: input.userId,
      session_id: input.sessionId,
      trigger: input.trigger,
      athlete_state_revision: input.revision,
      result: JSON.stringify(input.result)
    })
    .execute();
}

async function loadTerminalAdaptation(
  userId: string,
  sessionId: string,
  trigger: "session_completed" | "session_skipped"
): Promise<{ revision: number; result: Record<string, unknown> } | undefined> {
  const event = await getDb()
    .selectFrom("adaptation_events")
    .select(["athlete_state_revision", "result"])
    .where("user_id", "=", userId)
    .where("session_id", "=", sessionId)
    .where("trigger", "=", trigger)
    .executeTakeFirst();
  return event
    ? {
        revision: event.athlete_state_revision,
        result: event.result
      }
    : undefined;
}

export async function adaptAfterSet(
  userId: string,
  sessionId: string,
  setLogId: string
): Promise<Omit<AdaptiveSetLogResponse, "setLogId" | "accepted"> | undefined> {
  const context = await loadSessionContext(userId, sessionId);
  if (!context) return undefined;
  const latest = context.sets.find((set) => set.setLogId === setLogId);
  if (!latest) return undefined;
  const plannedExerciseSlug = await loadPlannedExerciseSlug(sessionId, latest.exerciseSlug);
  const plannedExercise = context.plan.exercises.find(
    (exercise) => exercise.exerciseSlug === plannedExerciseSlug
  );
  const plannedSet = plannedExercise?.sets.find((set) => set.index === latest.setIndex);
  if (!plannedExercise || !plannedSet) return undefined;
  const [athlete, rules] = await Promise.all([
    loadAthleteState(userId),
    loadRuleSet(context.plan.ruleSetVersion)
  ]);
  const exerciseSets = context.sets.filter(
    (set) =>
      set.exerciseSlug === latest.exerciseSlug &&
      (set.performedAt < latest.performedAt ||
        (set.performedAt === latest.performedAt && set.setIndex <= latest.setIndex))
  );
  let history = athlete.perExerciseHistory[latest.exerciseSlug];
  for (const set of exerciseSets) history = updateExerciseHistory(history, set, rules.adaptivity);
  const nextPlannedSet = plannedExercise.sets.find((set) => set.index === latest.setIndex + 1);
  const nextSetPrediction = nextPlannedSet
    ? predictNextSet({
        exerciseSlug: latest.exerciseSlug,
        e1RMEstimate: history?.e1RMEstimate,
        targetLoad: nextPlannedSet.targetLoad ?? latest.weight,
        targetReps: nextPlannedSet.targetReps,
        targetRir: nextPlannedSet.targetRir,
        completedSets: exerciseSets,
        repPerformanceAdjustment: history?.repPerformanceAdjustment,
        rules: rules.adaptivity
      })
    : null;
  const progression = recommendProgression({
    exerciseSlug: latest.exerciseSlug,
    performed: latest,
    targetReps: plannedSet.targetReps,
    targetRir: plannedSet.targetRir,
    rules: rules.adaptivity
  });
  const estimate = estimateE1RM(latest, rules.adaptivity);
  if (estimate) {
    const exercise = await getDb()
      .selectFrom("exercises")
      .select("id")
      .where("slug", "=", latest.exerciseSlug)
      .executeTakeFirstOrThrow();
    await getDb()
      .insertInto("exercise_performance_history")
      .values({
        user_id: userId,
        exercise_id: exercise.id,
        session_id: sessionId,
        set_log_id: setLogId,
        e1rm_estimate: estimate,
        load: latest.weight,
        reps: latest.reps,
        rir: latest.rir,
        performed_at: latest.performedAt
      })
      .onConflict((oc) => oc.column("set_log_id").doNothing())
      .execute();
  }
  await writeAdaptationEvent({
    userId,
    sessionId,
    trigger: "set_logged",
    revision: athlete.revision,
    result: { nextSetPrediction, progression }
  });
  return { nextSetPrediction, progression };
}

export async function recomputeCompletedSession(
  userId: string,
  sessionId: string,
  asOf: string
): Promise<AdaptiveCompleteSessionResponse | undefined> {
  const existing = await loadTerminalAdaptation(userId, sessionId, "session_completed");
  if (existing) {
    return {
      status: "completed",
      recomputeQueued: false,
      athleteStateRevision: existing.revision,
      deloadStatus: existing.result.deloadStatus as AdaptiveCompleteSessionResponse["deloadStatus"]
    };
  }
  const context = await loadSessionContext(userId, sessionId);
  if (!context) return undefined;
  const [athlete, catalog, volumeSets, rules] = await Promise.all([
    loadAthleteState(userId),
    loadCatalog(),
    loadRecentSets(userId, asOf),
    loadRuleSet(context.plan.ruleSetVersion)
  ]);
  const result = recomputeAfterSession({
    athlete,
    plan: context.plan,
    exercises: catalog.exercises,
    performedSets: context.sets,
    volumeSets,
    rules: rules.adaptivity,
    asOf
  });
  const revision = await updateAthleteState(userId, {
    perExerciseHistory: result.perExerciseHistory,
    perMuscleFatigue: result.perMuscleFatigue,
    volumeLedger: result.volumeLedger,
    deloadStatus: result.deloadStatus,
    lastRecomputedAt: asOf
  });
  const sessionStimulus = recomputeFatigue({
    current: {},
    asOf,
    exercises: catalog.exercises,
    performedSets: context.sets,
    rules: rules.adaptivity
  });
  const fatigueRows = Object.entries(sessionStimulus)
    .map(([muscleId, stimulus]) => ({
      user_id: userId,
      session_id: sessionId,
      muscle_id: muscleId,
      stimulus,
      occurred_at: asOf
    }))
    .filter((row) => row.stimulus > 0);
  if (fatigueRows.length)
    await getDb().insertInto("muscle_fatigue_events").values(fatigueRows).execute();
  await writeAdaptationEvent({
    userId,
    sessionId,
    trigger: "session_completed",
    revision,
    result: result as unknown as Record<string, unknown>
  });
  return {
    status: "completed",
    recomputeQueued: false,
    athleteStateRevision: revision,
    deloadStatus: result.deloadStatus
  };
}

export async function adaptSkippedSession(
  userId: string,
  sessionId: string,
  asOf: string
): Promise<AdaptiveSkipSessionResponse | undefined> {
  const existing = await loadTerminalAdaptation(userId, sessionId, "session_skipped");
  if (existing) {
    return {
      status: "skipped",
      penaltyApplied: false,
      redistributedSets: existing.result.redistributedSets as Record<string, number>,
      athleteStateRevision: existing.revision
    };
  }
  const context = await loadSessionContext(userId, sessionId);
  if (!context) return undefined;
  const athlete = await loadAthleteState(userId);
  const redistributedSets = skippedSessionRedistribution(context.plan);
  const revision = await updateAthleteState(userId, { lastRecomputedAt: asOf });
  await writeAdaptationEvent({
    userId,
    sessionId,
    trigger: "session_skipped",
    revision,
    result: { redistributedSets, volumeLedger: athlete.volumeLedger }
  });
  return {
    status: "skipped",
    penaltyApplied: false,
    redistributedSets,
    athleteStateRevision: revision
  };
}

export async function setSpecialization(
  userId: string,
  requested: Record<string, number>
): Promise<{ musclePriorities: Record<string, number>; athleteStateRevision: number }> {
  const catalog = await loadCatalog();
  const musclePriorities = applySpecialization(requested, Object.keys(catalog.muscleGroups));
  const revision = await updateAthleteState(userId, { musclePriorities });
  await getDb()
    .insertInto("adaptation_events")
    .values({
      user_id: userId,
      session_id: null,
      trigger: "manual",
      athlete_state_revision: revision,
      result: JSON.stringify({ musclePriorities })
    })
    .execute();
  return { musclePriorities, athleteStateRevision: revision };
}

export async function setManualDeload(
  userId: string,
  enabled: boolean,
  asOf: string
): Promise<{
  deloadStatus: AdaptiveCompleteSessionResponse["deloadStatus"];
  athleteStateRevision: number;
}> {
  const deloadStatus = {
    recommended: enabled,
    checkedAt: asOf,
    reason: enabled ? "Recovery week enabled manually" : "Recovery week disabled manually",
    source: "manual" as const
  };
  const revision = await updateAthleteState(userId, { deloadStatus });
  await getDb()
    .insertInto("adaptation_events")
    .values({
      user_id: userId,
      session_id: null,
      trigger: "manual",
      athlete_state_revision: revision,
      result: JSON.stringify({ deloadStatus })
    })
    .execute();
  return { deloadStatus, athleteStateRevision: revision };
}
