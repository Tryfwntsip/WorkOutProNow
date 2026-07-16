import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const direction = process.argv[2] === "down" ? "down" : "up";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");

await runner({
  databaseUrl,
  direction,
  dir: fileURLToPath(new URL("../migrations/", import.meta.url)),
  migrationsTable: "pgmigrations",
  count: direction === "down" ? 1 : Infinity,
  verbose: true
});
