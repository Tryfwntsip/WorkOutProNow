import {
  getDb,
  type BiologicalSex,
  type InjurySeverity,
  type TrainingAge,
  type WeeklySchedule
} from "@myoadapt/db";

function objectValue<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : fallback;
}

export interface BodyMetrics {
  sex?: BiologicalSex;
  heightCm?: number | null;
  weightKg?: number | null;
  birthYear?: number | null;
}

export interface ProfileInput extends BodyMetrics {
  trainingAge?: TrainingAge;
  recoveryProfile?: number;
  weeklySchedule?: WeeklySchedule;
  prefs?: Record<string, unknown>;
  injuries?: Array<{
    jointOrMuscle: string;
    severity?: InjurySeverity;
    constraints?: Record<string, unknown>;
  }>;
  environments?: Array<{ name: string; equipment?: string[] }>;
}

export interface ProfileView {
  userId: string;
  trainingAge: TrainingAge;
  recoveryProfile: number;
  weeklySchedule: WeeklySchedule;
  prefs: Record<string, unknown>;
  sex: BiologicalSex;
  heightCm: number | null;
  weightKg: number | null;
  birthYear: number | null;
  /** Derived from birthYear for convenience; null when unknown. */
  age: number | null;
  injuries: Array<{
    id: string;
    jointOrMuscle: string;
    severity: InjurySeverity;
    constraints: Record<string, unknown>;
  }>;
  environments: Array<{ id: string; name: string; equipment: string[] }>;
}

/** Resolve the local user id from a verified token subject, provisioning JIT. */
export async function resolveUserId(externalAuthId: string, email: string): Promise<string> {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto("users")
      .values({ external_auth_id: externalAuthId, email })
      .onConflict((oc) => oc.column("external_auth_id").doUpdateSet({ updated_at: new Date() }))
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("profiles")
      .values({ user_id: user.id })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();
    return user.id;
  });
}

/** Upsert profile core fields and replace child collections in one transaction. */
export async function saveProfile(userId: string, input: ProfileInput): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (input.trainingAge !== undefined) patch.training_age = input.trainingAge;
    if (input.recoveryProfile !== undefined) patch.recovery_profile = input.recoveryProfile;
    if (input.weeklySchedule !== undefined)
      patch.weekly_schedule = JSON.stringify(input.weeklySchedule);
    if (input.prefs !== undefined) {
      const existing = await trx
        .selectFrom("profiles")
        .select("prefs")
        .where("user_id", "=", userId)
        .executeTakeFirst();
      patch.prefs = JSON.stringify({
        ...objectValue<Record<string, unknown>>(existing?.prefs, {}),
        ...input.prefs
      });
    }
    if (input.sex !== undefined) patch.sex = input.sex;
    if (input.heightCm !== undefined) patch.height_cm = input.heightCm;
    if (input.weightKg !== undefined) patch.weight_kg = input.weightKg;
    if (input.birthYear !== undefined) patch.birth_year = input.birthYear;

    await trx.updateTable("profiles").set(patch).where("user_id", "=", userId).execute();

    if (input.injuries) {
      await trx.deleteFrom("profile_injuries").where("user_id", "=", userId).execute();
      if (input.injuries.length > 0) {
        await trx
          .insertInto("profile_injuries")
          .values(
            input.injuries.map((i) => ({
              user_id: userId,
              joint_or_muscle: i.jointOrMuscle,
              severity: i.severity ?? "mild",
              constraints: JSON.stringify(i.constraints ?? {})
            }))
          )
          .execute();
      }
    }

    if (input.environments) {
      await trx.deleteFrom("profile_environments").where("user_id", "=", userId).execute();
      if (input.environments.length > 0) {
        await trx
          .insertInto("profile_environments")
          .values(
            input.environments.map((e) => ({
              user_id: userId,
              name: e.name,
              equipment: e.equipment ?? []
            }))
          )
          .execute();
      }
    }
  });
}

export async function getProfile(userId: string): Promise<ProfileView | undefined> {
  const db = getDb();
  const profile = await db
    .selectFrom("profiles")
    .select([
      "user_id",
      "training_age",
      "recovery_profile",
      "weekly_schedule",
      "prefs",
      "sex",
      "height_cm",
      "weight_kg",
      "birth_year"
    ])
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!profile) return undefined;

  const [injuries, environments] = await Promise.all([
    db
      .selectFrom("profile_injuries")
      .select(["id", "joint_or_muscle", "severity", "constraints"])
      .where("user_id", "=", userId)
      .orderBy("created_at")
      .execute(),
    db
      .selectFrom("profile_environments")
      .select(["id", "name", "equipment"])
      .where("user_id", "=", userId)
      .orderBy("created_at")
      .execute()
  ]);

  return {
    userId: profile.user_id,
    trainingAge: profile.training_age,
    recoveryProfile: profile.recovery_profile,
    weeklySchedule: profile.weekly_schedule as WeeklySchedule,
    prefs: profile.prefs as Record<string, unknown>,
    sex: profile.sex,
    heightCm: profile.height_cm,
    weightKg: profile.weight_kg,
    birthYear: profile.birth_year,
    age: profile.birth_year ? new Date().getUTCFullYear() - profile.birth_year : null,
    injuries: injuries.map((i) => ({
      id: i.id,
      jointOrMuscle: i.joint_or_muscle,
      severity: i.severity,
      constraints: i.constraints as Record<string, unknown>
    })),
    environments: environments.map((e) => ({ id: e.id, name: e.name, equipment: e.equipment }))
  };
}
