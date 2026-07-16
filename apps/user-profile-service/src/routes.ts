import { badRequest, notFound, requireAuth } from "@myoadapt/http-kit";
import type { FastifyInstance } from "fastify";
import { getProfile, type ProfileInput, resolveUserId, saveProfile } from "./repo.js";

const profileBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    trainingAge: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
    recoveryProfile: { type: "number", minimum: 0, maximum: 1 },
    sex: { type: "string", enum: ["male", "female", "other", "unspecified"] },
    heightCm: { type: ["integer", "null"], minimum: 100, maximum: 260 },
    weightKg: { type: ["number", "null"], minimum: 30, maximum: 400 },
    birthYear: { type: ["integer", "null"], minimum: 1900, maximum: 2025 },
    weeklySchedule: {
      type: "object",
      additionalProperties: false,
      properties: {
        days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 } },
        minutesPerDay: { type: "integer", minimum: 1 }
      }
    },
    prefs: { type: "object" },
    injuries: {
      type: "array",
      items: {
        type: "object",
        required: ["jointOrMuscle"],
        additionalProperties: false,
        properties: {
          jointOrMuscle: { type: "string", minLength: 1 },
          severity: { type: "string", enum: ["mild", "moderate", "severe"] },
          constraints: { type: "object" }
        }
      }
    },
    environments: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          equipment: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
} as const;

async function currentUserId(sub: string, email?: string): Promise<string> {
  if (!email) throw badRequest("Token has no email claim");
  return resolveUserId(sub, email.toLowerCase());
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // POST /profile — create/update profile, prefs, injuries, environments (§5).
  app.post<{ Body: ProfileInput }>(
    "/profile",
    { preHandler: requireAuth, schema: { body: profileBody } },
    async (req) => {
      const userId = await currentUserId(req.user!.sub, req.user!.email);
      await saveProfile(userId, req.body);
      const view = await getProfile(userId);
      return view;
    }
  );

  // GET /profile — read the authenticated user's profile.
  app.get("/profile", { preHandler: requireAuth }, async (req) => {
    const userId = await currentUserId(req.user!.sub, req.user!.email);
    const view = await getProfile(userId);
    if (!view) throw notFound("Profile not found");
    return view;
  });
}
