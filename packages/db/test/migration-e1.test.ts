import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../migrations/1720000001000_exercise_science.cjs") as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

function recordingPgm() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const pgm = new Proxy(
    {},
    {
      get(_t, method: string) {
        return (...args: unknown[]) => {
          calls.push({ method, args });
          return undefined;
        };
      }
    }
  );
  return { pgm, calls };
}

describe("E1 exercise & science migration", () => {
  it("creates the exercise/science tables", () => {
    const { pgm, calls } = recordingPgm();
    expect(() => migration.up(pgm)).not.toThrow();

    const created = calls.filter((c) => c.method === "createTable").map((c) => c.args[0]);
    expect(new Set(created)).toEqual(
      new Set([
        "muscles",
        "equipment",
        "joints",
        "exercises",
        "exercise_muscles",
        "exercise_equipment",
        "exercise_joint_stress",
        "exercise_reviews",
        "rule_sets"
      ])
    );
  });

  it("does not leak E2 engine tables (athlete state / session plans / set logs)", () => {
    const { pgm, calls } = recordingPgm();
    migration.up(pgm);
    const created = calls.filter((c) => c.method === "createTable").map((c) => c.args[0]);
    for (const forbidden of ["athlete_state", "session_plans", "set_logs", "sessions"]) {
      expect(created).not.toContain(forbidden);
    }
  });

  it("down() drops every created table", () => {
    const { pgm, calls } = recordingPgm();
    expect(() => migration.down(pgm)).not.toThrow();
    const dropped = calls.filter((c) => c.method === "dropTable").map((c) => c.args[0]);
    expect(dropped.length).toBe(9);
  });
});
