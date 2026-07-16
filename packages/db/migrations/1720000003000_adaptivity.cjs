/* eslint-disable */
/**
 * E3 — adaptive performance history and recompute audit trail.
 *
 * The current adaptive snapshot stays in athlete_states. Append-only history
 * tables make e1RM, fatigue and deload decisions explainable and auditable.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType("adaptation_trigger", [
    "set_logged",
    "session_completed",
    "session_skipped",
    "manual"
  ]);

  pgm.createTable("exercise_performance_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)",
      onDelete: "CASCADE"
    },
    session_id: {
      type: "uuid",
      notNull: true,
      references: "sessions(id)",
      onDelete: "CASCADE"
    },
    set_log_id: {
      type: "uuid",
      notNull: true,
      unique: true,
      references: "set_logs(id)",
      onDelete: "CASCADE"
    },
    e1rm_estimate: { type: "real", notNull: true },
    load: { type: "real", notNull: true },
    reps: { type: "smallint", notNull: true },
    rir: { type: "real", notNull: true },
    performed_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("exercise_performance_history", ["user_id", "exercise_id", "performed_at"]);

  pgm.createTable("muscle_fatigue_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    session_id: {
      type: "uuid",
      references: "sessions(id)",
      onDelete: "CASCADE"
    },
    muscle_id: { type: "text", notNull: true, references: "muscles(id)" },
    stimulus: { type: "real", notNull: true },
    occurred_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("muscle_fatigue_events", "muscle_fatigue_events_stimulus_valid", {
    check: "stimulus >= 0"
  });
  pgm.createIndex("muscle_fatigue_events", ["user_id", "muscle_id", "occurred_at"]);

  pgm.createTable("adaptation_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    session_id: {
      type: "uuid",
      references: "sessions(id)",
      onDelete: "SET NULL"
    },
    trigger: { type: "adaptation_trigger", notNull: true },
    athlete_state_revision: { type: "integer", notNull: true },
    result: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("adaptation_events", ["user_id", "created_at"]);
  pgm.createIndex("adaptation_events", ["session_id", "trigger"], {
    name: "adaptation_events_terminal_unique",
    unique: true,
    where: "trigger IN ('session_completed', 'session_skipped')"
  });

  pgm.addColumns("athlete_states", {
    deload_status: { type: "jsonb", notNull: true, default: '{"recommended":false}' },
    last_recomputed_at: { type: "timestamptz" }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("athlete_states", ["deload_status", "last_recomputed_at"]);
  pgm.dropTable("adaptation_events");
  pgm.dropTable("muscle_fatigue_events");
  pgm.dropTable("exercise_performance_history");
  pgm.dropType("adaptation_trigger");
};
