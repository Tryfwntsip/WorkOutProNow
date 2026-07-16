import { createHash, randomBytes } from "node:crypto";
import { loadEnv } from "@myoadapt/config";
import { SignJWT } from "jose";

const env = loadEnv();
const encoder = new TextEncoder();

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

export interface AccessTokenClaims {
  subject: string;
  email: string;
}

/**
 * Mint a short-lived access JWT. In local mode it is HS256-signed with the dev
 * secret; in auth0 mode access tokens are issued by Auth0, so this is used only
 * for the local dev login flow.
 */
export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.subject)
    .setIssuer(env.AUTH_JWT_ISSUER)
    .setAudience(env.AUTH_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(encoder.encode(env.AUTH_LOCAL_DEV_SECRET));
}

export const accessTokenTtlSeconds = ACCESS_TOKEN_TTL_SECONDS;

/** Generate an opaque refresh token + its storable sha256 hash. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshExpiry(): Date {
  return new Date(Date.now() + env.SESSION_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}
