import { spawnSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";

loadDotenv();

for (const args of [["db:migrate"], ["--filter", "@myoadapt/science", "seed"]]) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
