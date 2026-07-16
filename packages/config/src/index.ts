import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load .env once on import. In CI/prod, real env vars take precedence.
loadDotenv();

const booleanFromString = z.enum(["true", "false"]).transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),

  AUTH_MODE: z.enum(["local", "auth0"]).default("local"),
  AUTH_JWT_ISSUER: z.string().url().default("https://myoadapt.dev/"),
  AUTH_JWT_AUDIENCE: z.string().min(1).default("myoadapt-api"),
  AUTH_LOCAL_DEV_SECRET: z.string().min(8).default("dev-only-insecure-secret-change-me"),
  AUTH0_DOMAIN: z.string().optional(),
  AUTH0_JWKS_URI: z.string().url().optional(),

  SESSION_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  IDENTITY_SERVICE_PORT: z.coerce.number().int().default(4001),
  USER_PROFILE_SERVICE_PORT: z.coerce.number().int().default(4002),
  ENGINE_SERVICE_PORT: z.coerce.number().int().default(4003),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAMESPACE: z.string().default("myoadapt"),
  METRICS_ENABLED: booleanFromString.default("true")
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

/**
 * Parse and validate process.env exactly once. Throws a readable error at
 * startup if any required variable is missing or malformed (fail-fast).
 */
export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = (env: AppEnv): boolean => env.NODE_ENV === "production";
