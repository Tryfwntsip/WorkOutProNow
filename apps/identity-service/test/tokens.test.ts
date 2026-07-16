import { beforeAll, describe, expect, it } from "vitest";

// Configure env BEFORE importing modules that read it at load time.
process.env.DATABASE_URL = "postgres://t:t@localhost:5432/t";
process.env.AUTH_MODE = "local";
process.env.AUTH_LOCAL_DEV_SECRET = "test-secret-at-least-8-chars";
process.env.AUTH_JWT_ISSUER = "https://myoadapt.test/";
process.env.AUTH_JWT_AUDIENCE = "myoadapt-api";

type TokensModule = typeof import("../src/tokens.js");
let tokens: TokensModule;

beforeAll(async () => {
  tokens = await import("../src/tokens.js");
});

describe("refresh tokens", () => {
  it("hashing is deterministic", () => {
    expect(tokens.hashRefreshToken("abc")).toBe(tokens.hashRefreshToken("abc"));
  });

  it("generates unique tokens whose hash matches", () => {
    const a = tokens.generateRefreshToken();
    const b = tokens.generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(tokens.hashRefreshToken(a.token));
  });

  it("expiry is in the future", () => {
    expect(tokens.refreshExpiry().getTime()).toBeGreaterThan(Date.now());
  });
});

describe("access tokens", () => {
  it("signs a verifiable HS256 JWT with the expected claims", async () => {
    const { jwtVerify } = await import("jose");
    const jwt = await tokens.signAccessToken({ subject: "user-1", email: "a@b.com" });

    const { payload } = await jwtVerify(
      jwt,
      new TextEncoder().encode(process.env.AUTH_LOCAL_DEV_SECRET!),
      { issuer: "https://myoadapt.test/", audience: "myoadapt-api" }
    );

    expect(payload.sub).toBe("user-1");
    expect(payload.email).toBe("a@b.com");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
