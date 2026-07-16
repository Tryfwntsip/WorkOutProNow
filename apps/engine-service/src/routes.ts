import {
  generateSession,
  type AdaptiveCompleteSessionResponse,
  type AdaptiveSetLogResponse,
  type AdaptiveSkipSessionResponse,
  type GeneratePlanResponse,
  type GenerationContext,
  type SetLogInput
} from "@myoadapt/engine";
import { badRequest, notFound, requireAuth } from "@myoadapt/http-kit";
import { engineRationaleTotal, engineStageDuration } from "@myoadapt/observability";
import type { FastifyInstance } from "fastify";
import {
  adaptAfterSet,
  adaptSkippedSession,
  recomputeCompletedSession,
  setManualDeload,
  setSpecialization
} from "./adaptivity-repo.js";
import {
  addExerciseToSession,
  clearProgram,
  finishSession,
  generateWeekPreview,
  listProgramTemplates,
  loadAthleteState,
  loadCatalog,
  loadExerciseAddOptions,
  loadExerciseSwaps,
  loadPerformanceAnalytics,
  loadProgram,
  loadRuleSet,
  logSet,
  persistExerciseSwap,
  persistPlan,
  resolveUserId,
  setProgram
} from "./repo.js";

interface PlanQuery {
  date: string;
  minutesAvailable?: number;
  environmentId?: string;
  ruleSetVersion?: string;
}

interface SwapQuery {
  environmentId?: string;
}

interface AddExerciseQuery {
  muscleId: string;
  environmentId?: string;
}

interface AnalyticsQuery {
  exerciseSlug?: string;
}

const planQuery = {
  type: "object",
  required: ["date"],
  additionalProperties: false,
  properties: {
    date: { type: "string", format: "date" },
    minutesAvailable: { type: "integer", minimum: 15, maximum: 240 },
    environmentId: { type: "string", format: "uuid" },
    ruleSetVersion: { type: "string" }
  }
} as const;

const setBody = {
  type: "object",
  required: ["clientSetId", "exerciseSlug", "setIndex", "weight", "reps", "rir", "performedAt"],
  additionalProperties: false,
  properties: {
    clientSetId: { type: "string", minLength: 1, maxLength: 100 },
    exerciseSlug: { type: "string", minLength: 1 },
    setIndex: { type: "integer", minimum: 1 },
    weight: { type: "number" },
    reps: { type: "integer", minimum: 0 },
    rir: { type: "number", minimum: 0 },
    performedAt: { type: "string", format: "date-time" }
  }
} as const;

const specializationBody = {
  type: "object",
  required: ["musclePriorities"],
  additionalProperties: false,
  properties: {
    musclePriorities: {
      type: "object",
      additionalProperties: { type: "number", minimum: 0.5, maximum: 2 }
    }
  }
} as const;

const deloadBody = {
  type: "object",
  required: ["enabled"],
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" }
  }
} as const;

const swapQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    environmentId: { type: "string", format: "uuid" }
  }
} as const;

const addExerciseQuery = {
  type: "object",
  required: ["muscleId"],
  additionalProperties: false,
  properties: {
    muscleId: { type: "string", minLength: 1 },
    environmentId: { type: "string", format: "uuid" }
  }
} as const;

const analyticsQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    exerciseSlug: { type: "string", minLength: 1 }
  }
} as const;

const templatesQuery = {
  type: "object",
  required: ["daysPerWeek"],
  additionalProperties: false,
  properties: {
    daysPerWeek: { type: "integer", minimum: 2, maximum: 6 }
  }
} as const;

const programBody = {
  type: "object",
  required: ["daysPerWeek", "splitId"],
  additionalProperties: false,
  properties: {
    daysPerWeek: { type: "integer", minimum: 2, maximum: 6 },
    splitId: { type: "string", minLength: 1 },
    // Optional custom training weekdays (0=Sun..6=Sat). Count must equal daysPerWeek.
    trainingDays: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 6 },
      minItems: 2,
      maxItems: 6
    }
  }
} as const;

const weekQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    startDate: { type: "string", format: "date" }
  }
} as const;

const sessionSwapBody = {
  type: "object",
  required: ["sourceExerciseSlug", "replacementExerciseSlug"],
  additionalProperties: false,
  properties: {
    sourceExerciseSlug: { type: "string", minLength: 1 },
    replacementExerciseSlug: { type: "string", minLength: 1 }
  }
} as const;

const sessionAddExerciseBody = {
  type: "object",
  required: ["exerciseSlug"],
  additionalProperties: false,
  properties: {
    exerciseSlug: { type: "string", minLength: 1 }
  }
} as const;

async function userId(req: { user?: { sub: string; email?: string } }): Promise<string> {
  if (!req.user?.email) throw badRequest("Token has no email claim");
  return resolveUserId(req.user.sub, req.user.email.toLowerCase());
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: PlanQuery }>(
    "/session/plan",
    { preHandler: requireAuth, schema: { querystring: planQuery } },
    async (req) => {
      const id = await userId(req);
      const context: GenerationContext = {
        date: req.query.date,
        ...(req.query.minutesAvailable ? { minutesAvailable: req.query.minutesAvailable } : {}),
        ...(req.query.environmentId ? { environmentId: req.query.environmentId } : {})
      };
      const [athlete, catalog, rules] = await Promise.all([
        loadAthleteState(id),
        loadCatalog(),
        loadRuleSet(req.query.ruleSetVersion)
      ]);
      const plan = generateSession(
        { athlete, catalog, rules, context },
        {
          stageCompleted(stage, durationMs, rationaleCount) {
            engineStageDuration.observe({ stage }, durationMs / 1000);
            engineRationaleTotal.inc({ stage }, rationaleCount);
          }
        }
      );
      const { sessionId } = await persistPlan(id, plan, context);
      return { sessionId, plan } satisfies GeneratePlanResponse;
    }
  );

  app.post<{
    Params: { id: string };
    Body: SetLogInput;
  }>("/session/:id/set", { preHandler: requireAuth, schema: { body: setBody } }, async (req) => {
    const id = await userId(req);
    const setLogId = await logSet(id, req.params.id, req.body);
    if (!setLogId) throw notFound("Session or exercise not found");
    const adaptive = await adaptAfterSet(id, req.params.id, setLogId);
    if (!adaptive) throw notFound("Planned set not found");
    return { setLogId, accepted: true, ...adaptive } satisfies AdaptiveSetLogResponse;
  });

  app.post<{ Params: { id: string } }>(
    "/session/:id/complete",
    { preHandler: requireAuth },
    async (req) => {
      const id = await userId(req);
      const updated = await finishSession(id, req.params.id, "completed");
      if (!updated) throw notFound("Active session not found");
      const result = await recomputeCompletedSession(id, req.params.id, new Date().toISOString());
      if (!result) throw notFound("Session plan not found");
      return result satisfies AdaptiveCompleteSessionResponse;
    }
  );

  app.post<{ Params: { id: string } }>(
    "/session/:id/skip",
    { preHandler: requireAuth },
    async (req) => {
      const id = await userId(req);
      const updated = await finishSession(id, req.params.id, "skipped");
      if (!updated) throw notFound("Active session not found");
      const result = await adaptSkippedSession(id, req.params.id, new Date().toISOString());
      if (!result) throw notFound("Session plan not found");
      return result satisfies AdaptiveSkipSessionResponse;
    }
  );

  app.post<{ Body: { musclePriorities: Record<string, number> } }>(
    "/tools/specialization",
    { preHandler: requireAuth, schema: { body: specializationBody } },
    async (req) => setSpecialization(await userId(req), req.body.musclePriorities)
  );

  app.post<{ Body: { enabled: boolean } }>(
    "/tools/deload",
    { preHandler: requireAuth, schema: { body: deloadBody } },
    async (req) => setManualDeload(await userId(req), req.body.enabled, new Date().toISOString())
  );

  app.get<{ Params: { slug: string }; Querystring: SwapQuery }>(
    "/exercise/:slug/swap",
    { preHandler: requireAuth, schema: { querystring: swapQuery } },
    async (req) => {
      const result = await loadExerciseSwaps(
        await userId(req),
        req.params.slug,
        req.query.environmentId
      );
      if (!result) throw notFound("Exercise not found");
      return result;
    }
  );

  app.get<{ Querystring: AddExerciseQuery }>(
    "/exercise/add",
    { preHandler: requireAuth, schema: { querystring: addExerciseQuery } },
    async (req) =>
      loadExerciseAddOptions(await userId(req), req.query.muscleId, req.query.environmentId)
  );

  app.get<{ Querystring: AnalyticsQuery }>(
    "/analytics/performance",
    { preHandler: requireAuth, schema: { querystring: analyticsQuery } },
    async (req) => loadPerformanceAnalytics(await userId(req), req.query.exerciseSlug)
  );

  // ── Program / split selection (guided onboarding) ────────────
  app.get<{ Querystring: { daysPerWeek: number } }>(
    "/programs/templates",
    { preHandler: requireAuth, schema: { querystring: templatesQuery } },
    async (req) => listProgramTemplates(req.query.daysPerWeek)
  );

  app.post<{ Body: { daysPerWeek: number; splitId: string; trainingDays?: number[] } }>(
    "/program",
    { preHandler: requireAuth, schema: { body: programBody } },
    async (req) => {
      const program = await setProgram(
        await userId(req),
        req.body.daysPerWeek,
        req.body.splitId,
        req.body.trainingDays
      );
      if (!program) throw badRequest("Unknown split for the requested frequency");
      return { program };
    }
  );

  app.get("/program", { preHandler: requireAuth }, async (req) => ({
    program: await loadProgram(await userId(req))
  }));

  app.delete("/program", { preHandler: requireAuth }, async (req, reply) => {
    await clearProgram(await userId(req));
    reply.status(204).send();
  });

  app.get<{ Querystring: { startDate?: string } }>(
    "/program/week",
    { preHandler: requireAuth, schema: { querystring: weekQuery } },
    async (req) => {
      const start = req.query.startDate ?? new Date().toISOString().slice(0, 10);
      return generateWeekPreview(await userId(req), start);
    }
  );

  app.post<{
    Params: { id: string };
    Body: { sourceExerciseSlug: string; replacementExerciseSlug: string };
  }>(
    "/session/:id/swap",
    { preHandler: requireAuth, schema: { body: sessionSwapBody } },
    async (req) => {
      const saved = await persistExerciseSwap(
        await userId(req),
        req.params.id,
        req.body.sourceExerciseSlug,
        req.body.replacementExerciseSlug
      );
      if (!saved) throw badRequest("Replacement exercise is not a safe swap");
      return { accepted: true, ...req.body };
    }
  );

  app.post<{ Params: { id: string }; Body: { exerciseSlug: string } }>(
    "/session/:id/exercise",
    { preHandler: requireAuth, schema: { body: sessionAddExerciseBody } },
    async (req) => {
      const result = await addExerciseToSession(
        await userId(req),
        req.params.id,
        req.body.exerciseSlug
      );
      if (!result) throw badRequest("Exercise cannot be added to this session");
      return result;
    }
  );
}
