/* eslint-disable */
/**
 * E2 — deterministic engine state, immutable plans and logging contract.
 *
 * Adaptivity calculations remain E3. E2 stores the state snapshot consumed by
 * the engine and the immutable output needed for reproducible golden plans.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType("session_status", ["planned", "in_progress", "completed", "skipped"]);

  pgm.createTable("athlete_states", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    muscle_priorities: { type: "jsonb", notNull: true, default: "{}" },
    excluded_muscles: { type: "text[]", notNull: true, default: "{}" },
    per_exercise_history: { type: "jsonb", notNull: true, default: "{}" },
    per_muscle_fatigue: { type: "jsonb", notNull: true, default: "{}" },
    volume_ledger: { type: "jsonb", notNull: true, default: "{}" },
    revision: { type: "integer", notNull: true, default: 1 },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createTrigger("athlete_states", "trg_athlete_states_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "set_updated_at"
  });

  pgm.createTable("sessions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    plan_id: { type: "text", notNull: true, unique: true },
    planned_for: { type: "date", notNull: true },
    environment_id: {
      type: "uuid",
      references: "profile_environments(id)",
      onDelete: "SET NULL"
    },
    status: { type: "session_status", notNull: true, default: "planned" },
    started_at: { type: "timestamptz" },
    completed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("sessions", ["user_id", "planned_for"]);

  pgm.createTable("session_plans", {
    plan_id: { type: "text", primaryKey: true },
    session_id: {
      type: "uuid",
      notNull: true,
      unique: true,
      references: "sessions(id)",
      onDelete: "CASCADE"
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    rule_set_version: {
      type: "text",
      notNull: true,
      references: "rule_sets(version)"
    },
    athlete_state_revision: { type: "integer", notNull: true },
    generation_context: { type: "jsonb", notNull: true },
    plan: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("session_plans", ["user_id", "created_at"]);

  pgm.createTable("set_logs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    session_id: {
      type: "uuid",
      notNull: true,
      references: "sessions(id)",
      onDelete: "CASCADE"
    },
    client_set_id: { type: "text", notNull: true },
    exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)"
    },
    set_index: { type: "smallint", notNull: true },
    weight: { type: "real", notNull: true },
    reps: { type: "smallint", notNull: true },
    rir: { type: "real", notNull: true },
    performed_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("set_logs", "set_logs_session_client_unique", {
    unique: ["session_id", "client_set_id"]
  });
  pgm.addConstraint("set_logs", "set_logs_values_valid", {
    check: "set_index > 0 AND reps >= 0 AND rir >= 0"
  });
  pgm.createIndex("set_logs", ["session_id", "set_index"]);
};

exports.down = (pgm) => {
  pgm.dropTable("set_logs");
  pgm.dropTable("session_plans");
  pgm.dropTable("sessions");
  pgm.dropTable("athlete_states");
  pgm.dropType("session_status");
};
