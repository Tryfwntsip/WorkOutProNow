import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../migrations/1720000002000_engine_v1.cjs") as {
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

describe("E2 engine migration", () => {
  it("creates state, immutable plans, sessions and set logs", () => {
    const { pgm, calls } = recordingPgm();
    migration.up(pgm);
    const created = calls.filter((c) => c.method === "createTable").map((c) => c.args[0]);
    expect(created).toEqual(["athlete_states", "sessions", "session_plans", "set_logs"]);
  });

  it("rolls back every E2 table", () => {
    const { pgm, calls } = recordingPgm();
    migration.down(pgm);
    expect(calls.filter((c) => c.method === "dropTable")).toHaveLength(4);
  });
});
