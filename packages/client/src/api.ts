import type {
  AdaptiveCompleteSessionResponse,
  AdaptiveSetLogResponse,
  AdaptiveSkipSessionResponse,
  CurrentUser,
  DeloadToolResponse,
  ExerciseAddOptionsResponse,
  ExerciseAddResponse,
  ExerciseSwapResponse,
  GeneratePlanResponse,
  PerformanceAnalyticsResponse,
  PlanQuery,
  ProfileInput,
  ProfileView,
  ProgramResponse,
  ProgramTemplatesResponse,
  SetLogInput,
  SpecializationResponse,
  TokenPair,
  WeekPreviewResponse
} from "./contracts.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ClientOptions {
  baseUrl: string;
  accessToken?: string | (() => string | undefined);
  /** Refresh token (or getter). Enables transparent re-auth on a 401. */
  refreshToken?: string | (() => string | undefined);
  /** Called with a fresh token pair after a successful silent refresh. */
  onTokens?: (tokens: TokenPair) => void;
  fetcher?: typeof fetch;
}

export class MyoAdaptApi {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private accessToken?: string | (() => string | undefined);
  private refreshToken?: string | (() => string | undefined);
  private readonly onTokens?: (tokens: TokenPair) => void;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.onTokens = options.onTokens;
  }

  setAccessToken(token?: string): void {
    this.accessToken = token;
  }

  setRefreshToken(token?: string): void {
    this.refreshToken = token;
  }

  devLogin(email: string): Promise<TokenPair> {
    return this.request("/auth/dev-login", {
      method: "POST",
      body: { email },
      authenticated: false
    });
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.request("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      authenticated: false
    });
  }

  me(): Promise<CurrentUser> {
    return this.request("/auth/me");
  }

  profile(): Promise<ProfileView> {
    return this.request("/profile");
  }

  saveProfile(input: ProfileInput): Promise<ProfileView> {
    return this.request("/profile", { method: "POST", body: input });
  }

  generatePlan(query: PlanQuery): Promise<GeneratePlanResponse> {
    return this.request(`/session/plan?${queryString({ ...query })}`);
  }

  logSet(sessionId: string, input: SetLogInput): Promise<AdaptiveSetLogResponse> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/set`, {
      method: "POST",
      body: input
    });
  }

  completeSession(sessionId: string): Promise<AdaptiveCompleteSessionResponse> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/complete`, { method: "POST" });
  }

  skipSession(sessionId: string): Promise<AdaptiveSkipSessionResponse> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/skip`, { method: "POST" });
  }

  exerciseSwaps(exerciseSlug: string, environmentId?: string): Promise<ExerciseSwapResponse> {
    const query = environmentId ? `?${queryString({ environmentId })}` : "";
    return this.request(`/exercise/${encodeURIComponent(exerciseSlug)}/swap${query}`);
  }

  exerciseAddOptions(
    muscleId: string,
    environmentId?: string
  ): Promise<ExerciseAddOptionsResponse> {
    return this.request(
      `/exercise/add?${queryString({ muscleId, ...(environmentId ? { environmentId } : {}) })}`
    );
  }

  addExercise(sessionId: string, exerciseSlug: string): Promise<ExerciseAddResponse> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/exercise`, {
      method: "POST",
      body: { exerciseSlug }
    });
  }

  applyExerciseSwap(
    sessionId: string,
    sourceExerciseSlug: string,
    replacementExerciseSlug: string
  ): Promise<{ accepted: true; sourceExerciseSlug: string; replacementExerciseSlug: string }> {
    return this.request(`/session/${encodeURIComponent(sessionId)}/swap`, {
      method: "POST",
      body: { sourceExerciseSlug, replacementExerciseSlug }
    });
  }

  performance(exerciseSlug?: string): Promise<PerformanceAnalyticsResponse> {
    const query = exerciseSlug ? `?${queryString({ exerciseSlug })}` : "";
    return this.request(`/analytics/performance${query}`);
  }

  setDeload(enabled: boolean): Promise<DeloadToolResponse> {
    return this.request("/tools/deload", { method: "POST", body: { enabled } });
  }

  setSpecialization(musclePriorities: Record<string, number>): Promise<SpecializationResponse> {
    return this.request("/tools/specialization", {
      method: "POST",
      body: { musclePriorities }
    });
  }

  // ── Program / split selection ──────────────────────────────
  programTemplates(daysPerWeek: number): Promise<ProgramTemplatesResponse> {
    return this.request(`/programs/templates?${queryString({ daysPerWeek })}`);
  }

  setProgram(
    daysPerWeek: number,
    splitId: string,
    trainingDays?: number[]
  ): Promise<ProgramResponse> {
    return this.request("/program", {
      method: "POST",
      body: { daysPerWeek, splitId, ...(trainingDays ? { trainingDays } : {}) }
    });
  }

  program(): Promise<ProgramResponse> {
    return this.request("/program");
  }

  deleteProgram(): Promise<void> {
    return this.request("/program", { method: "DELETE" });
  }

  weekPreview(startDate?: string): Promise<WeekPreviewResponse> {
    const query = startDate ? `?${queryString({ startDate })}` : "";
    return this.request(`/program/week${query}`);
  }

  private async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST" | "DELETE";
      body?: unknown;
      authenticated?: boolean;
      retried?: boolean;
    } = {}
  ): Promise<T> {
    const token = typeof this.accessToken === "function" ? this.accessToken() : this.accessToken;
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.authenticated !== false && token) headers.authorization = `Bearer ${token}`;
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });
    if (!response.ok) {
      // Transparently refresh once on an expired/invalid access token.
      if (
        response.status === 401 &&
        options.authenticated !== false &&
        !options.retried &&
        (await this.trySilentRefresh())
      ) {
        return this.request(path, { ...options, retried: true });
      }
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: { code?: string; message?: string } }
        | undefined;
      throw new ApiError(
        response.status,
        payload?.error?.code ?? "request_failed",
        payload?.error?.message ?? `Request failed with status ${response.status}`
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Attempt a one-shot refresh using the stored refresh token. */
  private async trySilentRefresh(): Promise<boolean> {
    const refreshToken =
      typeof this.refreshToken === "function" ? this.refreshToken() : this.refreshToken;
    if (!refreshToken) return false;
    try {
      const tokens = await this.refresh(refreshToken);
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.onTokens?.(tokens);
      return true;
    } catch {
      return false;
    }
  }
}

function queryString(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}
