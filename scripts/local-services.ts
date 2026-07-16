import { spawn } from "node:child_process";
import { connect } from "node:net";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const services = [
  {
    name: "identity",
    port: Number(process.env.IDENTITY_SERVICE_PORT ?? 4001),
    healthPath: "/health/ready",
    args: ["--filter", "@myoadapt/identity-service", "start"]
  },
  {
    name: "profile",
    port: Number(process.env.USER_PROFILE_SERVICE_PORT ?? 4002),
    healthPath: "/health/ready",
    args: ["--filter", "@myoadapt/user-profile-service", "start"]
  },
  {
    name: "engine",
    port: Number(process.env.ENGINE_SERVICE_PORT ?? 4003),
    healthPath: "/health/ready",
    args: ["--filter", "@myoadapt/engine-service", "start"]
  },
  {
    name: "client",
    port: Number(process.env.CLIENT_PORT ?? 3000),
    healthPath: "/manifest.webmanifest",
    args: ["--filter", "@myoadapt/client-app", "start"]
  }
] as const;

async function isHealthy(port: number, path: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return response.ok;
  } catch {
    return false;
  }
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function main(): Promise<void> {
  const statuses = await Promise.all(
    services.map(async (service) => ({
      service,
      healthy: await isHealthy(service.port, service.healthPath)
    }))
  );
  const conflicts = [];
  for (const status of statuses) {
    if (!status.healthy && (await isListening(status.service.port))) conflicts.push(status.service);
  }
  if (conflicts.length) {
    console.error(
      `Cannot start WorkOutProNow: unexpected process on ${conflicts
        .map((service) => `${service.name}:${service.port}`)
        .join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  const pending = statuses.filter((status) => !status.healthy).map((status) => status.service);
  const existing = statuses.filter((status) => status.healthy).map((status) => status.service.name);
  if (existing.length) console.log(`Already running: ${existing.join(", ")}`);
  if (!pending.length) {
    console.log("WorkOutProNow is already running at http://localhost:3000");
    return;
  }

  const children = pending.map(({ name, args }) => {
    const child = spawn("pnpm", args, { stdio: "inherit", env: process.env });
    child.once("exit", (code) => {
      if (code) console.error(`${name} exited with code ${code}`);
    });
    return child;
  });

  const shutdown = () => {
    for (const child of children) child.kill("SIGTERM");
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main();
