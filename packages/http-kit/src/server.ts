import {
  createLogger,
  httpRequestDuration,
  httpRequestsTotal,
  metricsContentType,
  metricsText
} from "@myoadapt/observability";
import Fastify from "fastify";
import { ApiError } from "./errors.js";

export type AppServer = ReturnType<typeof Fastify>;

export interface CreateServerOptions {
  serviceName: string;
  /** Optional async readiness check (e.g. db ping) for /health/ready. */
  readinessCheck?: () => Promise<boolean>;
}

/**
 * Build a Fastify instance preconfigured with the platform baseline:
 *  - structured logging (pino) with request ids
 *  - Prometheus request metrics + GET /metrics
 *  - GET /health/live and /health/ready probes
 *  - uniform ApiError serialization
 *
 * Routes are registered by the caller; the server is returned unstarted.
 */
export function createServer(opts: CreateServerOptions): AppServer {
  const logger = createLogger(opts.serviceName);

  const app = Fastify({
    logger,
    requestIdHeader: "x-request-id",
    disableRequestLogging: false,
    trustProxy: true
  });

  // ── Request metrics ──────────────────────────────────────────
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url ?? "unknown";
    const labels = {
      method: req.method,
      route,
      status_code: String(reply.statusCode)
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
  });

  // ── Uniform error handling ───────────────────────────────────
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    // Fastify validation errors → 400
    if ((err as { validation?: unknown }).validation) {
      reply.status(400).send({ error: { code: "validation_error", message: err.message } });
      return;
    }
    req.log.error({ err }, "unhandled error");
    reply.status(500).send({ error: { code: "internal_error", message: "Internal server error" } });
  });

  // ── Health probes ────────────────────────────────────────────
  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_req, reply) => {
    if (opts.readinessCheck) {
      const ready = await opts.readinessCheck().catch(() => false);
      if (!ready) {
        reply.status(503).send({ status: "unready" });
        return;
      }
    }
    return { status: "ready" };
  });

  // ── Metrics ──────────────────────────────────────────────────
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", metricsContentType);
    return metricsText();
  });

  return app;
}
