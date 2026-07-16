import { loadEnv } from "@myoadapt/config";
import { closeDb, pingDb } from "@myoadapt/db";
import { createServer } from "@myoadapt/http-kit";
import { registerRoutes } from "./routes.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = createServer({ serviceName: "engine-service", readinessCheck: pingDb });
  await registerRoutes(app);
  await app.listen({ host: "0.0.0.0", port: env.ENGINE_SERVICE_PORT });

  const shutdown = async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("engine-service failed to start", err);
  process.exit(1);
});
