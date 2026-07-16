import { loadEnv } from "@myoadapt/config";
import { pino, type Logger } from "pino";

/**
 * Structured JSON logger. In development we pretty-print; in staging/prod we
 * emit newline-delimited JSON for log shippers. Trace/span ids are attached by
 * the OTel pino instrumentation when a span is active.
 */
export function createLogger(serviceName: string): Logger {
  const env = loadEnv();
  return pino({
    name: serviceName,
    level: env.LOG_LEVEL,
    base: { service: serviceName, env: env.NODE_ENV },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.refresh_token",
        "*.refresh_token_hash",
        "*.password"
      ],
      censor: "[redacted]"
    },
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
        : undefined
  });
}
