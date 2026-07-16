import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../migrations/1720000004000_clients.cjs") as {
  up: (pgm: unknown) => void;
};

describe("E4 client execution migration", () => {
  it("stores swaps as an overlay without changing immutable session plans", () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const pgm = new Proxy(
      {},
      {
        get:
          (_target, method: string) =>
          (...args: unknown[]) =>
            calls.push({ method, args })
      }
    );
    migration.up(pgm);
    expect(
      calls.some(
        (call) => call.method === "createTable" && call.args[0] === "session_exercise_swaps"
      )
    ).toBe(true);
    expect(calls.some((call) => call.args[0] === "session_plans")).toBe(false);
  });
});
