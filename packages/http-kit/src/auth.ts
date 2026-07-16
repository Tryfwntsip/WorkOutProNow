import { loadEnv } from "@myoadapt/config";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "./errors.js";

export interface AuthenticatedUser {
  /** Token subject — Auth0 `sub` or local dev issuer subject. */
  sub: string;
  email?: string;
  scope?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

const encoder = new TextEncoder();

// Auth0 mode: verify RS256 via remote JWKS. Local mode: verify HS256 with the
// shared dev secret. The local issuer is for offline dev/CI only. Env is read
// lazily so importing the error helpers does not require full configuration.
let jwks: JWTVerifyGetKey | undefined;
function getJwks(jwksUri: string | undefined): JWTVerifyGetKey {
  if (!jwks) {
    if (!jwksUri) {
      throw new Error("AUTH0_JWKS_URI must be set when AUTH_MODE=auth0");
    }
    jwks = createRemoteJWKSet(new URL(jwksUri));
  }
  return jwks;
}

async function verifyToken(token: string): Promise<JWTPayload> {
  const env = loadEnv();
  const options = { issuer: env.AUTH_JWT_ISSUER, audience: env.AUTH_JWT_AUDIENCE };
  if (env.AUTH_MODE === "auth0") {
    const { payload } = await jwtVerify(token, getJwks(env.AUTH0_JWKS_URI), options);
    return payload;
  }
  const { payload } = await jwtVerify(token, encoder.encode(env.AUTH_LOCAL_DEV_SECRET), options);
  return payload;
}

function extractBearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? value : undefined;
}

/**
 * Fastify preHandler that authenticates the request via a Bearer JWT and
 * attaches `req.user`. Use on protected routes. The gateway (E0.4) also
 * enforces JWT at the edge; this is defence-in-depth at the service.
 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearer(req);
  if (!token) throw unauthorized("Missing bearer token");
  try {
    const payload = await verifyToken(token);
    if (!payload.sub) throw unauthorized("Token missing subject");
    req.user = {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      scope: typeof payload.scope === "string" ? payload.scope : undefined
    };
  } catch (err) {
    if (err instanceof Error && err.name === "ApiError") throw err;
    throw unauthorized("Invalid token");
  }
}
