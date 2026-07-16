import { closeDb, getDb } from "@myoadapt/db";
import type { ExerciseSeed } from "./schemas.js";
import { type ValidatedSeeds, validateSeeds } from "./validate.js";

const SEED_REVIEWER = "seed-curator";

/**
 * E1.2 — idempotent seed & curation pipeline. Validates the curated data first
 * (E1.4 gate), then upserts taxonomy → exercises (+ child mappings) → rule sets
 * in one transaction. Re-running converges to the same state. Approved seed
 * exercises get a recorded expert review to reflect the curation workflow.
 */
export async function seedDatabase(seeds: ValidatedSeeds): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    // ── Taxonomy ──────────────────────────────────────────────
    if (seeds.muscles.length) {
      await trx
        .insertInto("muscles")
        .values(seeds.muscles.map((m) => ({ id: m.id, name: m.name, muscle_group: m.muscleGroup })))
        .onConflict((oc) =>
          oc.column("id").doUpdateSet((eb) => ({
            name: eb.ref("excluded.name"),
            muscle_group: eb.ref("excluded.muscle_group")
          }))
        )
        .execute();
    }
    if (seeds.equipment.length) {
      await trx
        .insertInto("equipment")
        .values(seeds.equipment.map((e) => ({ id: e.id, name: e.name, category: e.category })))
        .onConflict((oc) =>
          oc.column("id").doUpdateSet((eb) => ({
            name: eb.ref("excluded.name"),
            category: eb.ref("excluded.category")
          }))
        )
        .execute();
    }
    if (seeds.joints.length) {
      await trx
        .insertInto("joints")
        .values(seeds.joints.map((j) => ({ id: j.id, name: j.name })))
        .onConflict((oc) => oc.column("id").doUpdateSet((eb) => ({ name: eb.ref("excluded.name") })))
        .execute();
    }

    // ── Exercises (upsert by slug, then resolve parents + children) ──
    const idBySlug = new Map<string, string>();
    for (const ex of seeds.exercises) {
      const row = await trx
        .insertInto("exercises")
        .values(exerciseValues(ex))
        .onConflict((oc) => oc.column("slug").doUpdateSet({ ...exerciseValues(ex), updated_at: new Date() }))
        .returning(["id", "slug"])
        .executeTakeFirstOrThrow();
      idBySlug.set(row.slug, row.id);
    }

    for (const ex of seeds.exercises) {
      const id = idBySlug.get(ex.slug)!;

      await trx
        .updateTable("exercises")
        .set({ parent_exercise_id: ex.parentSlug ? idBySlug.get(ex.parentSlug)! : null })
        .where("id", "=", id)
        .execute();

      // Replace child mappings.
      await trx.deleteFrom("exercise_muscles").where("exercise_id", "=", id).execute();
      await trx
        .insertInto("exercise_muscles")
        .values(ex.muscles.map((m) => ({ exercise_id: id, muscle_id: m.id, role: m.role })))
        .execute();

      await trx.deleteFrom("exercise_equipment").where("exercise_id", "=", id).execute();
      if (ex.equipment.length) {
        await trx
          .insertInto("exercise_equipment")
          .values(ex.equipment.map((e) => ({ exercise_id: id, equipment_id: e.id, required: e.required })))
          .execute();
      }

      await trx.deleteFrom("exercise_joint_stress").where("exercise_id", "=", id).execute();
      if (ex.jointStress.length) {
        await trx
          .insertInto("exercise_joint_stress")
          .values(ex.jointStress.map((j) => ({ exercise_id: id, joint_id: j.id, stress: j.stress })))
          .execute();
      }

      // Curation workflow: record an expert review for approved seeds.
      await trx
        .deleteFrom("exercise_reviews")
        .where("exercise_id", "=", id)
        .where("reviewer", "=", SEED_REVIEWER)
        .execute();
      if (ex.status === "approved") {
        await trx
          .insertInto("exercise_reviews")
          .values({
            exercise_id: id,
            reviewer: SEED_REVIEWER,
            decision: "approve",
            notes: "Seeded canonical exercise (curated)"
          })
          .execute();
      }
    }

    // ── Versioned rule sets (publish curated versions) ────────
    for (const rs of seeds.ruleSets) {
      const rulesJson = JSON.stringify(rs);
      await trx
        .insertInto("rule_sets")
        .values({
          version: rs.version,
          status: "published",
          rules: rulesJson,
          notes: rs.notes ?? null,
          published_at: new Date()
        })
        .onConflict((oc) =>
          oc.column("version").doUpdateSet({
            rules: rulesJson,
            status: "published",
            notes: rs.notes ?? null,
            published_at: new Date()
          })
        )
        .execute();
    }
  });
}

function exerciseValues(ex: ExerciseSeed) {
  return {
    slug: ex.slug,
    name: ex.name,
    mechanic: ex.mechanic,
    movement_pattern: ex.movementPattern ?? null,
    is_unilateral: ex.isUnilateral,
    loadability: ex.stimulus.loadability,
    stability: ex.stimulus.stability,
    stretch_emphasis: ex.stimulus.stretchEmphasis,
    fatigue_cost: ex.stimulus.fatigueCost,
    rep_min: ex.repRange.min,
    rep_max: ex.repRange.max,
    rest_min_seconds: ex.restBand.minSeconds,
    rest_max_seconds: ex.restBand.maxSeconds,
    contraindicated_injuries: ex.contraindicatedInjuries,
    status: ex.status
  };
}

// CLI entrypoint: `pnpm --filter @myoadapt/science seed`.
async function main(): Promise<void> {
  const result = validateSeeds();
  if (!result.ok) {
    console.error(`✗ refusing to seed — ${result.problems.length} validation problem(s):`);
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  await seedDatabase(result.seeds!);
  const s = result.seeds!;
  console.log(
    `✓ seeded ${s.muscles.length} muscles, ${s.equipment.length} equipment, ` +
      `${s.joints.length} joints, ${s.exercises.length} exercises, ${s.ruleSets.length} rule set(s)`
  );
  await closeDb();
}

// Run only when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error("seed failed", err);
    await closeDb();
    process.exit(1);
  });
}
