import { loadEnv } from "@myoadapt/config";
import { getDb } from "@myoadapt/db";
import { badRequest, forbidden, requireAuth, unauthorized } from "@myoadapt/http-kit";
import type { FastifyInstance } from "fastify";
import { createSession, findActiveSessionByHash, revokeSession, upsertUser } from "./repo.js";
import {
  accessTokenTtlSeconds,
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiry,
  signAccessToken
} from "./tokens.js";

const env = loadEnv();

const emailBody = {
  type: "object",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } }
} as const;

const refreshBody = {
  type: "object",
  required: ["refreshToken"],
  properties: { refreshToken: { type: "string", minLength: 16 } }
} as const;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── Local dev login (offline dev/CI only) ────────────────────
  app.post<{ Body: { email: string } }>(
    "/auth/dev-login",
    { schema: { body: emailBody } },
    async (req) => {
      if (env.AUTH_MODE !== "local") {
        throw forbidden("dev-login is disabled outside local auth mode");
      }
      const email = req.body.email.toLowerCase();
      const user = await upsertUser(`local|${email}`, email);
      return issueTokens(app, req, user.id, user.external_auth_id, user.email);
    }
  );

  // ── Refresh (rotating) ───────────────────────────────────────
  app.post<{ Body: { refreshToken: string } }>(
    "/auth/refresh",
    { schema: { body: refreshBody } },
    async (req) => {
      const session = await findActiveSessionByHash(hashRefreshToken(req.body.refreshToken));
      if (!session || session.revoked_at || session.expires_at <= new Date()) {
        throw unauthorized("Invalid or expired refresh token");
      }
      // Rotate: revoke the presented session, issue a fresh pair.
      await revokeSession(session.id);
      const user = await upsertUserById(session.user_id);
      return issueTokens(app, req, user.id, user.external_auth_id, user.email);
    }
  );

  // ── Logout ───────────────────────────────────────────────────
  app.post<{ Body: { refreshToken: string } }>(
    "/auth/logout",
    { schema: { body: refreshBody } },
    async (req, reply) => {
      const session = await findActiveSessionByHash(hashRefreshToken(req.body.refreshToken));
      if (session) await revokeSession(session.id);
      reply.status(204).send();
    }
  );

  // ── Current user (JIT provisioning from verified token) ──────
  app.get("/auth/me", { preHandler: requireAuth }, async (req) => {
    const principal = req.user;
    if (!principal?.email) throw badRequest("Token has no email claim");
    const user = await upsertUser(principal.sub, principal.email.toLowerCase());
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      subscriptionStatus: user.subscription_status
    };
  });
}

async function issueTokens(
  app: FastifyInstance,
  req: { headers: Record<string, unknown>; ip: string },
  userId: string,
  subject: string,
  email: string
): Promise<TokenPair> {
  const accessToken = await signAccessToken({ subject, email });
  const { token: refreshToken, hash } = generateRefreshToken();
  await createSession({
    userId,
    refreshTokenHash: hash,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    ip: req.ip ?? null,
    expiresAt: refreshExpiry()
  });
  app.log.info({ userId }, "issued token pair");
  return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: accessTokenTtlSeconds };
}

// Refresh rotation needs the user's email; re-read via a lightweight lookup.
async function upsertUserById(
  userId: string
): Promise<{ id: string; external_auth_id: string; email: string }> {
  const user = await getDb()
    .selectFrom("users")
    .select(["id", "external_auth_id", "email"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user) throw unauthorized("User no longer exists");
  return user;
}
