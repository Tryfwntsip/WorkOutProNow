# WorkOutProNow — Adaptive Training Platform

[![CI](https://github.com/Tryfwntsip/WorkOutProNow/actions/workflows/ci.yml/badge.svg)](https://github.com/Tryfwntsip/WorkOutProNow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Monorepo for the WorkOutProNow adaptive hypertrophy coaching platform.

> **Completed epics: E0 — Foundations & Schema, E1 — Exercise & Science DB,
> E2 — Engine v1, E3 — Adaptivity, E4 — Clients.**
> Deployable skeleton (auth, database, CI/CD, observability) plus a curated,
> expert-reviewed exercise catalog, versioned scientific-rules store, and a
> deterministic, explainable session-plan generator with adaptive performance,
> fatigue, progression and recovery logic, plus an offline-first installable
> mobile/web client.

## Stack

| Concern            | Choice                                           |
| ------------------ | ------------------------------------------------ |
| Language / runtime | TypeScript · Node 24                             |
| Monorepo           | pnpm workspaces + Turborepo                      |
| HTTP services      | Fastify                                          |
| Database           | PostgreSQL 16 + TimescaleDB                      |
| Migrations         | node-pg-migrate (SQL-first, versioned)           |
| Typed queries      | Kysely                                           |
| Auth (IdP)         | Auth0 in staging/prod · local dev issuer offline |
| API Gateway        | Kong (DB-less declarative)                       |
| Observability      | OpenTelemetry · pino · Prometheus                |

## Layout

```
apps/
  identity-service/        E0.2 — accounts, JWT, rotating refresh sessions
  user-profile-service/    profile, prefs, injuries, environments
  engine-service/          E2/E3/E4 — plans, adaptivity, swaps + analytics API
  client/                  E4 — responsive installable mobile/web PWA
packages/
  client/                  E4.1 — typed API SDK, offline queue + workflow helpers
  config/                  env loading + validation (zod)
  db/                      E0.3/E1.1 — migrations, typed schema, pg pool
  http-kit/                shared Fastify server, JWT auth, error model
  observability/           E0.5 — tracing, logging, metrics
  science/                 E1 — curated seeds, zod schemas, validation, seed pipeline
  engine/                  E2/E3 — deterministic pipeline + pure adaptive models
infra/
  gateway/kong.yml         E0.4 — routing + rate limiting
  docker-compose.yml       local stack (postgres, jaeger, services, gateway)
.github/workflows/ci.yml   E0.1 — lint · typecheck · test · build · images
```

## Quick start

```bash
pnpm install
cp .env.example .env

# Bring up the full local stack (postgres + jaeger + services + gateway)
pnpm infra:up

# Apply migrations against the running database
pnpm db:migrate
```

Public API entrypoint is the gateway at `http://localhost:8000`.
Mobile/web PWA at `http://localhost:3000`.
Jaeger UI at `http://localhost:16686`.

The Docker Compose stack is for local development only. Its database, service,
gateway, and observability ports bind to `127.0.0.1` and are not production
deployment defaults.

Without Docker/Kong, `pnpm local:setup` applies migrations/seeds and
`pnpm local:services` starts all Node services and the PWA. The PWA proxies
same-origin `/api` requests to the three local services.

The implementation is tracked against the original technical design in
[Design traceability](docs/design-traceability.md).

### Try the auth + profile flow (local mode)

```bash
# 1. Mint a dev token (local AUTH_MODE only)
TOKENS=$(curl -s localhost:8000/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"athlete@example.com"}')
ACCESS=$(echo "$TOKENS" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# 2. Create / update the profile
curl -s localhost:8000/profile -H "authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' \
  -d '{"trainingAge":"intermediate","weeklySchedule":{"days":[1,3,5],"minutesPerDay":60},
       "injuries":[{"jointOrMuscle":"shoulder","severity":"mild"}],
       "environments":[{"name":"Home","equipment":["dumbbell","bench"]}]}'

# 3. Read it back
curl -s localhost:8000/profile -H "authorization: Bearer $ACCESS"
```

## Development

```bash
pnpm lint        # eslint (flat config)
pnpm typecheck   # tsc --noEmit across the workspace
pnpm test        # vitest
pnpm build       # tsc build of every package/app
```

Run a single service in watch mode (needs a reachable `DATABASE_URL`):

```bash
pnpm --filter @myoadapt/identity-service dev
```

## Database & migrations (E0.3)

The first migration (`packages/db/migrations/1720000000000_init.cjs`) creates the
foundational identity / account / profile schema **only**:

`users`, `user_sessions`, `profiles`, `profile_injuries`, `profile_environments`.

Exercise, scientific-rule, athlete-state, session/plan/log and adaptive-history
tables belong to E1/E2/E3 and are added in their own migrations.

```bash
pnpm db:migrate          # up
pnpm db:migrate:down     # roll back the last migration
pnpm --filter @myoadapt/db migrate:create my_change   # scaffold a new migration
```

Migrations:

- `1720000000000_init` — E0.3 identity / account / profile.
- `1720000001000_exercise_science` — E1.1/E1.3 exercise catalog, taxonomy, reviews, versioned rule sets.
- `1720000002000_engine_v1` — E2 athlete state, immutable plans, sessions and idempotent set logs.
- `1720000003000_adaptivity` — E3 performance history, fatigue events, adaptation audit trail and deload state.
- `1720000004000_clients` — E4 immutable-plan execution overlays for accepted exercise swaps.
- `1720000005000_profile_metrics` — optional sex, height, weight and birth-year profile metrics.

## Exercise & Science data (E1)

Curated data lives as reviewable JSON under `packages/science/seeds/`
(taxonomy, `exercises.json`, `rules/<semver>.json`). It is validated structurally
(zod) and referentially (muscle/equipment/joint mappings) before it can be seeded.

```bash
pnpm --filter @myoadapt/science validate   # E1.4 integrity check (no DB)
pnpm --filter @myoadapt/science seed        # idempotent upsert into PostgreSQL
```

The seed pipeline records an expert review for each approved exercise and
publishes each rule-set version, so an old `SessionPlan` can always be reproduced
against the `ruleSetVersion` that was active at the time.

### Hypertrophy rule set `1.1.0`

New plans use training-age-aware weekly hard-set targets: beginner `4–10`,
intermediate `8–15`, and advanced `11–18` sets per muscle. Specialization is
bounded at `10/20/30` sets respectively. The engine distributes volume across
the sessions where each muscle actually appears in the selected split.

Only sets performed at `0–2 RIR` count as hard-set volume; primary muscles
receive `1.0` set credit and secondary muscles `0.5`. Prescriptions stay in the
practical `5–15` rep range, use at least `90s` rest (`150–180s` for compounds),
and favor exercises with a strong loaded-stretch profile. Progressive overload
recommends additional reps before load; additional sets are prescribed from the
remaining weekly volume deficit.

The last working set of each normal hypertrophy exercise targets `0.5 RIR`.
Recovery-week prescriptions keep the higher deload RIR instead. The selected
session size and time budget remain hard constraints: the engine trims
lower-priority volume before it exceeds the available time.

## Deterministic Engine v1 (E2)

`@myoadapt/engine` is a stateless, pure TypeScript pipeline:

`routine selection → muscle allocation → exercise selection → set/rep/load → ordering/time fitting`

Every decision emits structured rationale tags. The plan ID is a deterministic
hash of the athlete input, context, rule-set version and generated decisions.
The persisted plan is immutable, and golden files protect behavior per rule-set.

Guided sessions default to a minimum `45`-minute budget. Duration estimation
includes session warm-up, exercise setup, working time and prescribed rest.
For full-body sessions, muscle allocation explicitly prioritizes major movement
groups before smaller isolation targets. A five-exercise full-body session
therefore starts from chest, back, legs and shoulders; direct forearm work is
only considered when there is spare capacity or an explicit specialization.

Frozen API contract version: `1.0.0`.

```text
GET  /session/plan?date=YYYY-MM-DD&minutesAvailable=60&environmentId=<uuid>
POST /session/{id}/set
POST /session/{id}/complete
POST /session/{id}/skip
```

Set logging is idempotent through `clientSetId`. In-session prediction, fatigue
recompute, progression and deload decisions are additive E3 responses under
adaptive API contract `1.1.0`; the frozen E2 plan contract and golden file remain
unchanged.

## Adaptive Engine (E3)

The pure adaptive model estimates per-exercise e1RM, learns a rep-performance
adjustment, predicts the next set, recommends progression, tracks rolling
seven-day hard-set volume and models per-muscle fatigue with time decay.

Session completion currently performs the recompute synchronously and persists
the new athlete-state revision plus append-only audit events. Completion and
skip retries are idempotent. A detected or manually enabled recovery week lowers
volume and load while increasing target RIR in subsequent plans.

All thresholds, including e1RM, fatigue, progression, deload and recovery-week
parameters, live in the active versioned scientific rule set.

```text
POST /session/{id}/set       -> next-set prediction + progression
POST /session/{id}/complete  -> fatigue/volume/history recompute + deload status
POST /session/{id}/skip      -> no penalty; missed volume remains available
POST /tools/specialization   -> bounded muscle-priority emphasis
POST /tools/deload           -> manually enable/disable a recovery week
```

## Mobile + Web Clients (E4)

`@myoadapt/client` is a framework-agnostic typed SDK for auth, onboarding,
profile, plan, set logging, adaptivity, swaps, recovery tools and analytics. Its
persistent offline queue writes every set locally before sync and retains the
same `clientSetId` across retries.

`apps/client` is a responsive installable PWA serving both mobile and web. It
supports the full `manage → preview → perform → complete` loop, local pre-session
adjustments, negative assisted-load values, rationale-driven “Why?” views,
safe exercise swaps, skip/deload tools and Δe1RM analytics.

Session plans remain immutable. Accepted swaps are persisted as execution
overlays so the replacement exercise can be logged and audited without rewriting
the original recommendation.

```bash
pnpm --filter @myoadapt/client-app dev
```

## Guided programs & split selection

Onboarding now produces a complete program the way a personal trainer would: the
user answers **how many days per week** they can train, then picks a
**science-based split**. The engine follows the chosen split's weekly rotation
instead of auto-deriving the routine from frequency (it falls back to auto when
no program is set, preserving the E2 golden contract).

The same screen asks for the preferred session size:

| Choice                    | Intended use                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| 3 exercises — Short       | Minimum effective dose for busy days, beginners or recovery weeks  |
| 5 exercises — Recommended | Default balance of effective volume, variety and recovery          |
| 6 exercises — More        | Experienced trainees with more time and consistently good recovery |

The detailed Profile screen can still store a wider `2–8` exercise preference.
The final plan may contain fewer exercises when equipment, injury constraints,
available muscles or the time budget make the requested count unsafe.

Split templates live in `@myoadapt/science` (`splits.ts`), validated and
unit-tested:

| Split              | Days   | Weekly rotation                         |
| ------------------ | ------ | --------------------------------------- |
| Full Body          | 2–3    | full body each session                  |
| Upper / Lower      | 4      | U · L · U · L                           |
| Push / Pull / Legs | 3 or 6 | P · P · L (×1 or ×2)                    |
| PPL + Upper/Lower  | 5      | P · P · L · U · L                       |
| Arnold             | 6      | chest+back · shoulders+arms · legs (×2) |

Program API (engine-service, behind the gateway):

```
GET  /programs/templates?daysPerWeek=N   # recommended splits for a frequency
POST /program            { daysPerWeek, splitId }   # choose + persist a split
GET  /program                            # current program
GET  /program/week?startDate=YYYY-MM-DD  # full-week preview (read-only)
```

The curated exercise catalog was expanded to **54 exercises across 14 equipment
types**, so every muscle has multiple equipment variants. The web client's
**Swap** button now lists same-muscle, equipment- and injury-safe alternatives
ranked by stimulus match and lets the user choose the replacement.

## Definition of Done — status

**E0 — Foundations & Schema**

| Task | Deliverable                                                         | ✓   |
| ---- | ------------------------------------------------------------------- | --- |
| E0.1 | Monorepo, CI/CD pipeline, dev/staging/prod env config               | ✅  |
| E0.2 | Identity service — JWT, rotating refresh sessions, JIT accounts     | ✅  |
| E0.3 | Core PostgreSQL schema + node-pg-migrate framework                  | ✅  |
| E0.4 | Kong API gateway — routing, rate limiting, CORS, correlation ids    | ✅  |
| E0.5 | Observability baseline — OTel traces, pino logs, Prometheus metrics | ✅  |

**E1 — Exercise & Science Database**

| Task | Deliverable                                                             | ✓   |
| ---- | ----------------------------------------------------------------------- | --- |
| E1.1 | Exercise schema — muscles, equipment, stimulus profile, joint stress    | ✅  |
| E1.2 | Seed & curation pipeline + expert-review workflow                       | ✅  |
| E1.3 | Versioned scientific-rules store (semver, volume/rep/RIR/rest defaults) | ✅  |
| E1.4 | Data validation & integrity tests (muscle/equipment mappings)           | ✅  |

**E2 — Engine v1 (Deterministic)**

| Task  | Deliverable                                                      | ✓   |
| ----- | ---------------------------------------------------------------- | --- |
| E2.1  | Athlete State model + load/persist/incremental-update repository | ✅  |
| E2.2  | Typed pipeline stages + orchestrator                             | ✅  |
| E2.3  | Routine Selection                                                | ✅  |
| E2.4  | Muscle Allocation                                                | ✅  |
| E2.5  | Equipment/injury-aware Exercise Selection                        | ✅  |
| E2.6  | Set / Rep / Load prescription                                    | ✅  |
| E2.7  | Ordering + Time Fitting                                          | ✅  |
| E2.8  | Structured rationale tags per stage                              | ✅  |
| E2.9  | Golden-file suite per rule-set version                           | ✅  |
| E2.10 | Frozen SessionPlan and logging API contract `1.0.0`              | ✅  |

**E3 — Adaptivity**

| Task | Deliverable                                                    | ✓   |
| ---- | -------------------------------------------------------------- | --- |
| E3.1 | Per-exercise e1RM estimation + rep-performance model           | ✅  |
| E3.2 | In-session rep prediction + progression rules                  | ✅  |
| E3.3 | Per-muscle fatigue accumulation + time decay                   | ✅  |
| E3.4 | Deload detection + versioned recovery-week logic               | ✅  |
| E3.5 | Missed-workout handling + volume-ledger redistribution         | ✅  |
| E3.6 | Bounded specialization through muscle-priority volume emphasis | ✅  |

**E4 — Clients (Mobile + Web)**

| Task | Deliverable                                                      | ✓   |
| ---- | ---------------------------------------------------------------- | --- |
| E4.1 | Shared typed API client + additive client contracts              | ✅  |
| E4.2 | Onboarding for profile, goals, environment and injuries          | ✅  |
| E4.3 | Plan → Preview screen with local execution adjustments           | ✅  |
| E4.4 | Offline-first perform/set logging with idempotent reconnect sync | ✅  |
| E4.5 | Explainability “Why?” rationale views                            | ✅  |
| E4.6 | Safe exercise swap overlays, skip and deload tools               | ✅  |
| E4.7 | Performance analytics view using Δe1RM history                   | ✅  |

## Safety disclaimer

WorkOutProNow provides informational training suggestions, not medical advice.
Stop exercising and seek qualified medical guidance for pain, injury, unusual
symptoms, or concerns about whether a program is appropriate for you.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Report
suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).
