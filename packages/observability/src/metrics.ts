import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

/**
 * Per-process Prometheus registry. Default Node/process metrics plus a baseline
 * HTTP request histogram. Exposed by services at GET /metrics.
 */
export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2],
  registers: [registry]
});

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [registry]
});

export const engineStageDuration = new Histogram({
  name: "engine_stage_duration_seconds",
  help: "Deterministic engine pipeline stage duration",
  labelNames: ["stage"],
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [registry]
});

export const engineRationaleTotal = new Counter({
  name: "engine_rationale_total",
  help: "Rationale tags emitted by engine stage",
  labelNames: ["stage"],
  registers: [registry]
});

export async function metricsText(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;
