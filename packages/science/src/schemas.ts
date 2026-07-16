import { z } from "zod";

/**
 * Zod schemas for the curated Exercise & Science seed data (E1). These define
 * the shape of the reviewable JSON files in `seeds/` and are the structural
 * half of E1.4 validation; cross-reference integrity is in `validate.ts`.
 */

// Semver (major.minor.patch with optional pre-release/build), per E1.3.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-]+)?$/;

const slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_]+$/, "slug must be lower_snake_case");

const unit = z.number().min(0).max(1); // normalized 0..1

// ── Taxonomy ─────────────────────────────────────────────────
export const muscleSchema = z.object({
  id: slug,
  name: z.string().min(1),
  muscleGroup: z.string().min(1)
});

export const equipmentSchema = z.object({
  id: slug,
  name: z.string().min(1),
  category: z.string().min(1)
});

export const jointSchema = z.object({
  id: slug,
  name: z.string().min(1)
});

// ── Exercise seed record (§4.1) ──────────────────────────────
export const exerciseStatusSchema = z.enum(["draft", "in_review", "approved", "deprecated"]);

export const exerciseSeedSchema = z
  .object({
    slug,
    name: z.string().min(1),
    parentSlug: slug.optional(),
    mechanic: z.enum(["compound", "isolation"]),
    movementPattern: z.string().min(1).optional(),
    isUnilateral: z.boolean().default(false),
    stimulus: z.object({
      loadability: unit,
      stability: unit,
      stretchEmphasis: unit,
      fatigueCost: unit
    }),
    repRange: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    restBand: z.object({
      minSeconds: z.number().int().positive(),
      maxSeconds: z.number().int().positive()
    }),
    muscles: z.array(z.object({ id: slug, role: z.enum(["primary", "secondary"]) })).min(1),
    equipment: z.array(z.object({ id: slug, required: z.boolean().default(true) })).default([]),
    jointStress: z.array(z.object({ id: slug, stress: unit })).default([]),
    contraindicatedInjuries: z.array(slug).default([]),
    status: exerciseStatusSchema.default("draft")
  })
  .refine((e) => e.repRange.max >= e.repRange.min, {
    message: "repRange.max must be >= repRange.min",
    path: ["repRange"]
  })
  .refine((e) => e.restBand.maxSeconds >= e.restBand.minSeconds, {
    message: "restBand.maxSeconds must be >= restBand.minSeconds",
    path: ["restBand"]
  })
  .refine((e) => e.muscles.some((m) => m.role === "primary"), {
    message: "exercise must have at least one primary muscle",
    path: ["muscles"]
  });

export type ExerciseSeed = z.infer<typeof exerciseSeedSchema>;
export type MuscleSeed = z.infer<typeof muscleSchema>;
export type EquipmentSeed = z.infer<typeof equipmentSchema>;
export type JointSeed = z.infer<typeof jointSchema>;

// ── Versioned scientific rules document (§3.3, E1.3) ─────────
const range = z
  .object({ min: z.number(), max: z.number() })
  .refine((r) => r.max >= r.min, { message: "max must be >= min" });

export const adaptivityRulesSchema = z
  .object({
    e1rmRepsDivisor: z.number().positive(),
    fatigueDropPerSet: z.number().nonnegative(),
    fatigueHalfLifeHours: z.number().positive(),
    fatiguePerSetScale: z.number().positive(),
    secondaryMuscleCredit: z.number().min(0).max(1),
    hardSetMaxRir: z.number().min(0).max(5).default(4),
    loadIncrementPct: z.number().positive(),
    minimumLoadIncrement: z.number().positive(),
    deloadDeclinePct: z.number().min(0).max(1),
    deloadFatigueThreshold: z.number().min(0).max(1),
    deloadMinDecliningExercises: z.number().int().positive(),
    recoveryVolumeMultiplier: z.number().min(0).max(1),
    recoveryLoadMultiplier: z.number().min(0).max(1),
    recoveryMinRir: z.number().nonnegative()
  })
  .default({
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
  });

export const ruleSetSchema = z.object({
  version: z.string().regex(SEMVER, "version must be valid semver"),
  notes: z.string().optional(),
  // Weekly hard sets per muscle (default 8–12), with optional per-muscle overrides.
  weeklyVolume: z.object({
    default: range,
    perMuscle: z.record(slug, range).default({}),
    byTrainingAge: z
      .object({
        beginner: range,
        intermediate: range,
        advanced: range
      })
      .optional(),
    specializationMaxByTrainingAge: z
      .object({
        beginner: z.number().positive(),
        intermediate: z.number().positive(),
        advanced: z.number().positive()
      })
      .optional()
  }),
  // Cap of hard sets per muscle within a single session (~10).
  setsPerSessionCap: z.number().int().positive(),
  // Emphasised rep ranges (e.g. 5–10 and 10–15).
  repRanges: z.array(range).min(1),
  // Target proximity to failure (0–3 RIR).
  rir: range,
  // Default rest bands (seconds) by exercise mechanic (60–120s).
  restSecondsByMechanic: z.object({
    compound: range,
    isolation: range
  }),
  adaptivity: adaptivityRulesSchema
});

export type RuleSet = z.infer<typeof ruleSetSchema>;
export type AdaptivityRules = z.infer<typeof adaptivityRulesSchema>;
