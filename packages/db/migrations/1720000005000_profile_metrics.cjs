/* eslint-disable */
/**
 * Profile body metrics — height, body weight, year of birth and biological sex.
 * Stored on the profile so the engine can (in future) personalise selection and
 * load suggestions (e.g. bodyweight-relative movements). All nullable so they
 * are optional during onboarding.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType("biological_sex", ["male", "female", "other", "unspecified"]);

  pgm.addColumns("profiles", {
    sex: { type: "biological_sex", notNull: true, default: "unspecified" },
    height_cm: { type: "smallint" },
    weight_kg: { type: "real" },
    birth_year: { type: "smallint" }
  });

  pgm.addConstraint("profiles", "profiles_height_cm_range", {
    check: "height_cm IS NULL OR (height_cm BETWEEN 100 AND 260)"
  });
  pgm.addConstraint("profiles", "profiles_weight_kg_range", {
    check: "weight_kg IS NULL OR (weight_kg BETWEEN 30 AND 400)"
  });
  pgm.addConstraint("profiles", "profiles_birth_year_range", {
    check: "birth_year IS NULL OR (birth_year BETWEEN 1900 AND 2025)"
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("profiles", "profiles_birth_year_range");
  pgm.dropConstraint("profiles", "profiles_weight_kg_range");
  pgm.dropConstraint("profiles", "profiles_height_cm_range");
  pgm.dropColumns("profiles", ["sex", "height_cm", "weight_kg", "birth_year"]);
  pgm.dropType("biological_sex");
};
