import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../migrations/1720000000000_init.cjs") as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

/** Records every pgm.<method>(...) call so we can assert the schema shape. */
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

describe("init migration", () => {
  it("up() runs and creates the foundational tables only", () => {
    const { pgm, calls } = recordingPgm();
    expect(() => migration.up(pgm)).not.toThrow();

    const createdTables = calls
      .filter((c) => c.method === "createTable")
      .map((c) => c.args[0]);

    expect(createdTables).toEqual([
      "users",
      "user_sessions",
      "profiles",
      "profile_injuries",
      "profile_environments"
    ]);

    // Scope guard: no E1/E2 engine tables leak into E0.
    for (const forbidden of ["exercises", "athlete_state", "session_plans", "set_logs"]) {
      expect(createdTables).not.toContain(forbidden);
    }
  });

  it("down() runs and drops every created table", () => {
    const { pgm, calls } = recordingPgm();
    expect(() => migration.down(pgm)).not.toThrow();

    const droppedTables = calls
      .filter((c) => c.method === "dropTable")
      .map((c) => c.args[0]);

    expect(new Set(droppedTables)).toEqual(
      new Set(["users", "user_sessions", "profiles", "profile_injuries", "profile_environments"])
    );
  });
});
