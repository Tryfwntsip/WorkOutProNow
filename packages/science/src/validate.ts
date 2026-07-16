import { z } from "zod";
import { loadRawSeeds } from "./load-seeds.js";
import {
  type EquipmentSeed,
  type ExerciseSeed,
  type JointSeed,
  type MuscleSeed,
  type RuleSet,
  equipmentSchema,
  exerciseSeedSchema,
  jointSchema,
  muscleSchema,
  ruleSetSchema
} from "./schemas.js";

export interface ValidatedSeeds {
  muscles: MuscleSeed[];
  equipment: EquipmentSeed[];
  joints: JointSeed[];
  exercises: ExerciseSeed[];
  ruleSets: RuleSet[];
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
  seeds?: ValidatedSeeds;
}

function parseArray<S extends z.ZodTypeAny>(
  label: string,
  schema: S,
  raw: unknown,
  problems: string[]
): z.output<S>[] {
  const arr = z.array(schema).safeParse(raw);
  if (!arr.success) {
    for (const issue of arr.error.issues) {
      problems.push(`${label}[${issue.path.join(".")}]: ${issue.message}`);
    }
    return [];
  }
  return arr.data;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/**
 * E1.4 — structural (zod) + referential-integrity validation of the curated
 * Exercise & Science seed data. Runs without a database so it can gate CI and
 * the seed pipeline before anything touches PostgreSQL.
 */
export function validateSeeds(): ValidationResult {
  const problems: string[] = [];
  const raw = loadRawSeeds();

  const muscles = parseArray("muscles", muscleSchema, raw.muscles, problems);
  const equipment = parseArray("equipment", equipmentSchema, raw.equipment, problems);
  const joints = parseArray("joints", jointSchema, raw.joints, problems);
  const exercises = parseArray("exercises", exerciseSeedSchema, raw.exercises, problems);

  const ruleSets: RuleSet[] = [];
  for (const rs of raw.ruleSets) {
    const parsed = ruleSetSchema.safeParse(rs.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${rs.file}[${issue.path.join(".")}]: ${issue.message}`);
      }
    } else {
      ruleSets.push(parsed.data);
    }
  }

  // ── Taxonomy uniqueness ─────────────────────────────────────
  const muscleIds = new Set(muscles.map((m) => m.id));
  const equipmentIds = new Set(equipment.map((e) => e.id));
  const jointIds = new Set(joints.map((j) => j.id));
  for (const [label, dupes] of [
    ["muscles", findDuplicates(muscles.map((m) => m.id))],
    ["equipment", findDuplicates(equipment.map((e) => e.id))],
    ["joints", findDuplicates(joints.map((j) => j.id))]
  ] as const) {
    if (dupes.length) problems.push(`${label}: duplicate ids ${dupes.join(", ")}`);
  }

  // ── Exercise referential integrity (E1.4 muscle/equipment maps) ──
  const slugs = exercises.map((e) => e.slug);
  const slugSet = new Set(slugs);
  for (const dup of findDuplicates(slugs)) problems.push(`exercises: duplicate slug "${dup}"`);

  for (const ex of exercises) {
    for (const m of ex.muscles) {
      if (!muscleIds.has(m.id)) {
        problems.push(`exercise "${ex.slug}": unknown muscle "${m.id}"`);
      }
    }
    for (const eq of ex.equipment) {
      if (!equipmentIds.has(eq.id)) {
        problems.push(`exercise "${ex.slug}": unknown equipment "${eq.id}"`);
      }
    }
    for (const js of ex.jointStress) {
      if (!jointIds.has(js.id)) {
        problems.push(`exercise "${ex.slug}": unknown joint "${js.id}"`);
      }
    }
    for (const inj of ex.contraindicatedInjuries) {
      if (!jointIds.has(inj)) {
        problems.push(`exercise "${ex.slug}": unknown contraindicated injury "${inj}"`);
      }
    }
    if (ex.parentSlug && !slugSet.has(ex.parentSlug)) {
      problems.push(`exercise "${ex.slug}": unknown parentSlug "${ex.parentSlug}"`);
    }
  }

  // ── Rule set integrity ──────────────────────────────────────
  const versions = ruleSets.map((r) => r.version);
  for (const dup of findDuplicates(versions)) {
    problems.push(`rule sets: duplicate version "${dup}"`);
  }
  for (const rs of ruleSets) {
    for (const muscleId of Object.keys(rs.weeklyVolume.perMuscle)) {
      if (!muscleIds.has(muscleId)) {
        problems.push(`rule set ${rs.version}: perMuscle references unknown muscle "${muscleId}"`);
      }
    }
  }

  const ok = problems.length === 0;
  return {
    ok,
    problems,
    seeds: ok ? { muscles, equipment, joints, exercises, ruleSets } : undefined
  };
}
