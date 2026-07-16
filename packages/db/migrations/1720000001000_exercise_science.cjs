/* eslint-disable */
/**
 * E1.1/E1.3 — Exercise & Science Database schema.
 *
 * Builds on the E0.3 foundational framework. Adds the curated exercise catalog,
 * its muscle/equipment/joint taxonomy mappings, an expert-review workflow, and
 * the versioned scientific-rules store. No engine logic lives here (that is E2);
 * these are read-heavy reference tables the engine will later consume.
 *
 * Tables are created empty — taxonomy, exercises and rule sets are loaded by the
 * E1.2 seed/curation pipeline (packages/science) so curated content stays in
 * reviewable data files rather than migrations.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ── Enums ─────────────────────────────────────────────────────
  pgm.createType("exercise_status", ["draft", "in_review", "approved", "deprecated"]);
  pgm.createType("exercise_mechanic", ["compound", "isolation"]);
  pgm.createType("muscle_role", ["primary", "secondary"]);
  pgm.createType("review_decision", ["approve", "reject", "request_changes"]);
  pgm.createType("rule_set_status", ["draft", "published", "archived"]);

  // ── Taxonomy (natural-key reference tables) ───────────────────
  pgm.createTable("muscles", {
    id: { type: "text", primaryKey: true }, // slug, e.g. "chest"
    name: { type: "text", notNull: true },
    muscle_group: { type: "text", notNull: true } // e.g. "push", "legs"
  });

  pgm.createTable("equipment", {
    id: { type: "text", primaryKey: true }, // slug, e.g. "barbell"
    name: { type: "text", notNull: true },
    category: { type: "text", notNull: true } // e.g. "free_weight", "machine"
  });

  pgm.createTable("joints", {
    id: { type: "text", primaryKey: true }, // slug, e.g. "shoulder"
    name: { type: "text", notNull: true }
  });

  // ── Exercises ─────────────────────────────────────────────────
  pgm.createTable("exercises", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    slug: { type: "text", notNull: true, unique: true },
    name: { type: "text", notNull: true },
    // Variations link back to a base exercise (Exercise.variations[] in §4.1).
    parent_exercise_id: {
      type: "uuid",
      references: "exercises(id)",
      onDelete: "SET NULL"
    },
    mechanic: { type: "exercise_mechanic", notNull: true },
    movement_pattern: { type: "text" }, // e.g. "horizontal_press"
    is_unilateral: { type: "boolean", notNull: true, default: false },

    // stimulusProfile (§4.1) — each normalized 0..1.
    loadability: { type: "real", notNull: true },
    stability: { type: "real", notNull: true },
    stretch_emphasis: { type: "real", notNull: true },
    fatigue_cost: { type: "real", notNull: true },

    // repRangeSuitability + defaultRestBand (§4.1).
    rep_min: { type: "smallint", notNull: true },
    rep_max: { type: "smallint", notNull: true },
    rest_min_seconds: { type: "smallint", notNull: true },
    rest_max_seconds: { type: "smallint", notNull: true },

    // jointStress.contraindicatedInjuries[] — tags (e.g. "lower_back", "knee").
    contraindicated_injuries: { type: "text[]", notNull: true, default: "{}" },

    status: { type: "exercise_status", notNull: true, default: "draft" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("exercises", "status");
  pgm.createIndex("exercises", "parent_exercise_id");
  pgm.addConstraint("exercises", "exercises_stimulus_range", {
    check: `
      loadability >= 0 AND loadability <= 1 AND
      stability >= 0 AND stability <= 1 AND
      stretch_emphasis >= 0 AND stretch_emphasis <= 1 AND
      fatigue_cost >= 0 AND fatigue_cost <= 1
    `
  });
  pgm.addConstraint("exercises", "exercises_rep_range_valid", {
    check: "rep_min > 0 AND rep_max >= rep_min"
  });
  pgm.addConstraint("exercises", "exercises_rest_band_valid", {
    check: "rest_min_seconds > 0 AND rest_max_seconds >= rest_min_seconds"
  });
  pgm.createTrigger("exercises", "trg_exercises_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "set_updated_at" // reuse the E0.3 shared trigger function
  });

  // ── Exercise ⇄ muscle (primary/secondary) ─────────────────────
  pgm.createTable("exercise_muscles", {
    exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)",
      onDelete: "CASCADE"
    },
    muscle_id: { type: "text", notNull: true, references: "muscles(id)" },
    role: { type: "muscle_role", notNull: true }
  });
  pgm.addConstraint("exercise_muscles", "exercise_muscles_pkey", {
    primaryKey: ["exercise_id", "muscle_id"]
  });
  pgm.createIndex("exercise_muscles", "muscle_id");

  // ── Exercise ⇄ equipment ──────────────────────────────────────
  pgm.createTable("exercise_equipment", {
    exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)",
      onDelete: "CASCADE"
    },
    equipment_id: { type: "text", notNull: true, references: "equipment(id)" },
    required: { type: "boolean", notNull: true, default: true }
  });
  pgm.addConstraint("exercise_equipment", "exercise_equipment_pkey", {
    primaryKey: ["exercise_id", "equipment_id"]
  });
  pgm.createIndex("exercise_equipment", "equipment_id");

  // ── Exercise ⇄ joint stress ───────────────────────────────────
  pgm.createTable("exercise_joint_stress", {
    exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)",
      onDelete: "CASCADE"
    },
    joint_id: { type: "text", notNull: true, references: "joints(id)" },
    stress: { type: "real", notNull: true } // 0..1
  });
  pgm.addConstraint("exercise_joint_stress", "exercise_joint_stress_pkey", {
    primaryKey: ["exercise_id", "joint_id"]
  });
  pgm.addConstraint("exercise_joint_stress", "exercise_joint_stress_range", {
    check: "stress >= 0 AND stress <= 1"
  });

  // ── Expert-review workflow (E1.2) ─────────────────────────────
  pgm.createTable("exercise_reviews", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)",
      onDelete: "CASCADE"
    },
    reviewer: { type: "text", notNull: true },
    decision: { type: "review_decision", notNull: true },
    notes: { type: "text" },
    reviewed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("exercise_reviews", "exercise_id");

  // ── Versioned scientific rules (E1.3) ─────────────────────────
  pgm.createTable("rule_sets", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    version: { type: "text", notNull: true, unique: true }, // semver
    status: { type: "rule_set_status", notNull: true, default: "draft" },
    rules: { type: "jsonb", notNull: true }, // validated against the science schema
    notes: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    published_at: { type: "timestamptz" }
  });
};

exports.down = (pgm) => {
  pgm.dropTable("rule_sets");
  pgm.dropTable("exercise_reviews");
  pgm.dropTable("exercise_joint_stress");
  pgm.dropTable("exercise_equipment");
  pgm.dropTable("exercise_muscles");
  pgm.dropTable("exercises");
  pgm.dropTable("joints");
  pgm.dropTable("equipment");
  pgm.dropTable("muscles");
  pgm.dropType("rule_set_status");
  pgm.dropType("review_decision");
  pgm.dropType("muscle_role");
  pgm.dropType("exercise_mechanic");
  pgm.dropType("exercise_status");
};
