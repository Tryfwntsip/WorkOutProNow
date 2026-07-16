import { getDb } from "@myoadapt/db";

export interface UserRecord {
  id: string;
  external_auth_id: string;
  email: string;
  status: string;
  subscription_status: string;
}

/**
 * Just-in-time account provisioning: look up by external auth id (Auth0 sub or
 * local dev subject), inserting the user + an empty profile on first sight.
 * Idempotent — safe to call on every authenticated request.
 */
export async function upsertUser(externalAuthId: string, email: string): Promise<UserRecord> {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto("users")
      .values({ external_auth_id: externalAuthId, email })
      .onConflict((oc) =>
        oc.column("external_auth_id").doUpdateSet({ email, updated_at: new Date() })
      )
      .returning(["id", "external_auth_id", "email", "status", "subscription_status"])
      .executeTakeFirstOrThrow();

    // Ensure a 1—1 profile row exists.
    await trx
      .insertInto("profiles")
      .values({ user_id: user.id })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();

    return user;
  });
}

export async function findUserByExternalId(externalAuthId: string): Promise<UserRecord | undefined> {
  return getDb()
    .selectFrom("users")
    .select(["id", "external_auth_id", "email", "status", "subscription_status"])
    .where("external_auth_id", "=", externalAuthId)
    .executeTakeFirst();
}

// ── Sessions ───────────────────────────────────────────────────

export async function createSession(params: {
  userId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}): Promise<string> {
  const row = await getDb()
    .insertInto("user_sessions")
    .values({
      user_id: params.userId,
      refresh_token_hash: params.refreshTokenHash,
      user_agent: params.userAgent,
      ip: params.ip,
      expires_at: params.expiresAt
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function findActiveSessionByHash(hash: string): Promise<SessionRecord | undefined> {
  return getDb()
    .selectFrom("user_sessions")
    .select(["id", "user_id", "expires_at", "revoked_at"])
    .where("refresh_token_hash", "=", hash)
    .executeTakeFirst();
}

export async function revokeSession(id: string): Promise<void> {
  await getDb()
    .updateTable("user_sessions")
    .set({ revoked_at: new Date() })
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .execute();
}
