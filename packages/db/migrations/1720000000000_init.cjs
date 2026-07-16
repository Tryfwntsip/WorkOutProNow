/* eslint-disable */
/**
 * E0.3 — Core schema (foundational identity / account / profile only).
 *
 * SCOPE GUARD: This migration intentionally does NOT create any exercise,
 * scientific-rule, athlete-state, session-plan, set-log or engine tables.
 * Those belong to E1 (Exercise & Science DB) and E2 (Engine v1) and must be
 * added in their own migrations on top of this framework.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ── Extensions ────────────────────────────────────────────────
  pgm.createExtension("pgcrypto", { ifNotExists: true }); // gen_random_uuid()
  pgm.createExtension("citext", { ifNotExists: true }); // case-insensitive email

  // ── Enums ─────────────────────────────────────────────────────
  pgm.createType("training_age", ["beginner", "intermediate", "advanced"]);
  pgm.createType("account_status", ["active", "suspended", "deleted"]);
  // Minimal placeholder; full billing/entitlements land in E5 (Monetization).
  pgm.createType("subscription_status", ["none", "trialing", "active", "past_due", "canceled"]);
  pgm.createType("injury_severity", ["mild", "moderate", "severe"]);

  // ── Shared updated_at trigger function ────────────────────────
  pgm.createFunction(
    "set_updated_at",
    [],
    { returns: "trigger", language: "plpgsql", replace: true },
    `
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    `
  );

  // ── users ─────────────────────────────────────────────────────
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Auth0 `sub` (or local dev issuer subject). One identity per user.
    external_auth_id: { type: "text", notNull: true, unique: true },
    email: { type: "citext", notNull: true, unique: true },
    status: { type: "account_status", notNull: true, default: "active" },
    // Placeholder so the User entity (§4.2) is representable; wired in E5.
    subscription_status: { type: "subscription_status", notNull: true, default: "none" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createTrigger("users", "trg_users_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "set_updated_at"
  });

  // ── user_sessions (E0.2 — refresh/session tracking) ───────────
  pgm.createTable("user_sessions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    // We store only a hash of the refresh token, never the token itself.
    refresh_token_hash: { type: "text", notNull: true, unique: true },
    user_agent: { type: "text" },
    ip: { type: "inet" },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("user_sessions", "user_id");
  pgm.createIndex("user_sessions", "expires_at");

  // ── profiles (1—1 with users) ─────────────────────────────────
  pgm.createTable("profiles", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    training_age: { type: "training_age", notNull: true, default: "beginner" },
    // 0..1 normalized recovery profile (from questionnaire + adherence).
    recovery_profile: { type: "real", notNull: true, default: 0.5 },
    // { days: number[], minutesPerDay: number }
    weekly_schedule: { type: "jsonb", notNull: true, default: "{}" },
    // free-form preferences (excludedMuscles, musclePriorities live here for now)
    prefs: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("profiles", "profiles_recovery_profile_range", {
    check: "recovery_profile >= 0 AND recovery_profile <= 1"
  });
  pgm.createTrigger("profiles", "trg_profiles_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "set_updated_at"
  });

  // ── profile_injuries (N per user) ─────────────────────────────
  pgm.createTable("profile_injuries", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    // Free text now (joint or muscle). Becomes FK to muscle taxonomy in E1.
    joint_or_muscle: { type: "text", notNull: true },
    severity: { type: "injury_severity", notNull: true, default: "mild" },
    // engine-facing constraints, e.g. { avoidExercises: [], maxLoadPct: 0.6 }
    constraints: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("profile_injuries", "user_id");

  // ── profile_environments (N per user) ─────────────────────────
  pgm.createTable("profile_environments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE"
    },
    name: { type: "text", notNull: true }, // e.g. "Home gym", "Travel"
    // Free-text equipment tags now; normalized against equipment table in E1.
    equipment: { type: "text[]", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("profile_environments", "user_id");
  pgm.addConstraint("profile_environments", "profile_environments_user_name_unique", {
    unique: ["user_id", "name"]
  });
};

exports.down = (pgm) => {
  pgm.dropTable("profile_environments");
  pgm.dropTable("profile_injuries");
  pgm.dropTable("profiles");
  pgm.dropTable("user_sessions");
  pgm.dropTable("users");
  pgm.dropFunction("set_updated_at", []);
  pgm.dropType("injury_severity");
  pgm.dropType("subscription_status");
  pgm.dropType("account_status");
  pgm.dropType("training_age");
  // Extensions left in place (may be shared by later migrations).
};
