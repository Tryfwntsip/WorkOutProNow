import type { AdaptiveSetLogResponse, SessionPlan } from "@myoadapt/engine";
import { describe, expect, it } from "vitest";
import {
  MemoryQueueStorage,
  MyoAdaptApi,
  OfflineSetQueue,
  adjustPlannedSet,
  createSessionDraft,
  stableClientSetId
} from "../src/index.js";

const response: AdaptiveSetLogResponse = {
  setLogId: "log-1",
  accepted: true,
  nextSetPrediction: null,
  progression: { exerciseSlug: "bench", action: "hold", loadDelta: 0, rationale: "ok" }
};

describe("E4 offline set queue", () => {
  it("deduplicates retries by stable clientSetId and syncs in order", async () => {
    const sent: string[] = [];
    const queue = new OfflineSetQueue(new MemoryQueueStorage(), async (_sessionId, input) => {
      sent.push(input.clientSetId);
      return response;
    });
    const performedAt = "2026-06-06T10:00:00.000Z";
    const clientSetId = stableClientSetId("session", "bench", 1, performedAt);
    const input = {
      clientSetId,
      exerciseSlug: "bench",
      setIndex: 1,
      weight: 80,
      reps: 8,
      rir: 2,
      performedAt
    };
    await queue.enqueue("session", input);
    await queue.enqueue("session", input);
    expect(await queue.pending()).toHaveLength(1);
    expect(await queue.flush()).toMatchObject({ pending: 0 });
    expect(sent).toEqual([clientSetId]);
  });

  it("keeps failed work for reconnect sync", async () => {
    const queue = new OfflineSetQueue(new MemoryQueueStorage(), async () => {
      throw new Error("offline");
    });
    await queue.enqueue("session", {
      clientSetId: "set-1",
      exerciseSlug: "bench",
      setIndex: 1,
      weight: -20,
      reps: 8,
      rir: 2,
      performedAt: "2026-06-06T10:00:00.000Z"
    });
    const result = await queue.flush();
    expect(result.pending).toBe(1);
    expect(result.failed?.attempts).toBe(1);
  });
});

describe("E4 preview adjustments", () => {
  it("edits a draft without mutating the immutable source plan", () => {
    const source = {
      exercises: [
        { exerciseSlug: "bench", exerciseName: "Bench", sets: [{ index: 1, targetLoad: 80 }] }
      ]
    } as SessionPlan;
    const draft = adjustPlannedSet(createSessionDraft("session", source), "bench", 1, {
      targetLoad: 82.5
    });
    expect(draft.plan.exercises[0]?.sets[0]?.targetLoad).toBe(82.5);
    expect(source.exercises[0]?.sets[0]?.targetLoad).toBe(80);
  });
});

describe("E4 typed API client", () => {
  it("binds the default browser fetch to the global scope", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(JSON.stringify({ accessToken: "access", refreshToken: "refresh" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    } as typeof fetch;

    try {
      const api = new MyoAdaptApi({ baseUrl: "https://api.test" });
      await expect(api.devLogin("athlete@example.com")).resolves.toMatchObject({
        accessToken: "access"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves negative assisted loads and sends bearer auth", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const api = new MyoAdaptApi({
      baseUrl: "https://api.test",
      accessToken: "token",
      fetcher: async (url, init) => {
        request = { url: String(url), init };
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    await api.logSet("session", {
      clientSetId: "assisted-1",
      exerciseSlug: "pull_up",
      setIndex: 1,
      weight: -20,
      reps: 8,
      rir: 2,
      performedAt: "2026-06-06T10:00:00.000Z"
    });
    expect(request?.init?.headers).toMatchObject({ authorization: "Bearer token" });
    expect(request?.init?.body).toContain('"weight":-20');
  });

  it("requests muscle-specific additions and persists the selected exercise", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const api = new MyoAdaptApi({
      baseUrl: "https://api.test",
      accessToken: "token",
      fetcher: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ muscleId: "chest", options: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    await api.exerciseAddOptions("chest");
    await api.addExercise("session", "incline_barbell_press");
    expect(requests[0]?.url).toBe("https://api.test/exercise/add?muscleId=chest");
    expect(requests[1]?.url).toBe("https://api.test/session/session/exercise");
    expect(requests[1]?.init?.body).toBe('{"exerciseSlug":"incline_barbell_press"}');
  });
});
