/* eslint-disable */
/**
 * E4 — client execution adjustments.
 *
 * Session plans remain immutable. Accepted exercise swaps are stored as an
 * execution overlay so offline clients can log the replacement safely while
 * preserving the original recommendation and its rationale.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("session_exercise_swaps", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    session_id: {
      type: "uuid",
      notNull: true,
      references: "sessions(id)",
      onDelete: "CASCADE"
    },
    source_exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)"
    },
    replacement_exercise_id: {
      type: "uuid",
      notNull: true,
      references: "exercises(id)"
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("session_exercise_swaps", "session_exercise_swaps_source_unique", {
    unique: ["session_id", "source_exercise_id"]
  });
  pgm.addConstraint("session_exercise_swaps", "session_exercise_swaps_replacement_unique", {
    unique: ["session_id", "replacement_exercise_id"]
  });
};

exports.down = (pgm) => {
  pgm.dropTable("session_exercise_swaps");
};
