// Loaded via `node --import ./tracing.js` BEFORE the app so HTTP/pg/fastify are
// auto-instrumented. Keep this file side-effecting and dependency-light.
import { startTracing } from "@myoadapt/observability";

startTracing("identity-service");
