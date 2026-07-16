import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../migrations/1720000003000_adaptivity.cjs") as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

function recordingPgm() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const pgm = new Proxy(
    {},
    {
      get(_t, method: string) {
        return (...args: unknown[]) => calls.push({ method, args });
      }
    }
  );
  return { pgm, calls };
}

describe("E3 adaptivity migration", () => {
  it("creates append-only performance, fatigue and adaptation history", () => {
    const { pgm, calls } = recordingPgm();
    migration.up(pgm);
    expect(calls.filter((c) => c.method === "createTable").map((c) => c.args[0])).toEqual([
      "exercise_performance_history",
      "muscle_fatigue_events",
      "adaptation_events"
    ]);
  });

  it("extends athlete state without changing E2 plan tables", () => {
    const { pgm, calls } = recordingPgm();
    migration.up(pgm);
    expect(calls.some((c) => c.method === "addColumns" && c.args[0] === "athlete_states")).toBe(
      true
    );
    expect(calls.some((c) => c.method === "addColumns" && c.args[0] === "session_plans")).toBe(
      false
    );
  });
});
