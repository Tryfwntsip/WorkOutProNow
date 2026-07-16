# WorkOutProNow Design Traceability

This document maps the implementation to `MyoAdapt_Design (1).docx`, version
1.1. The design remains the architectural source of truth; this file records
the current implementation status and the product-level decisions added during
E2–E4 tuning.

## Architecture

| Design layer                | Implementation                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Mobile and web clients      | Installable offline-first PWA in `apps/client` plus typed SDK in `packages/client`   |
| API gateway                 | DB-less Kong configuration in `infra/gateway/kong.yml`                               |
| Identity                    | `apps/identity-service`, JWT access tokens and rotating refresh sessions             |
| User and profile            | `apps/user-profile-service`, PostgreSQL profile, injuries, equipment and preferences |
| Adaptive programming engine | Pure deterministic pipeline in `packages/engine`, exposed by `apps/engine-service`   |
| Exercise and science data   | Curated seeds, validation and versioned rule sets in `packages/science`              |
| Persistence                 | PostgreSQL migrations and typed Kysely schema in `packages/db`                       |
| Observability               | OpenTelemetry tracing, pino logs and Prometheus metrics                              |

## Epic Status

| Epic | Design definition of done                                                      | Current status  |
| ---- | ------------------------------------------------------------------------------ | --------------- |
| E0   | Deployable auth, database, CI/CD and observability foundation                  | Complete        |
| E1   | Curated exercise catalog and versioned scientific rules                        | Complete        |
| E2   | Deterministic `SessionPlan`, rationale tags and golden tests                   | Complete        |
| E3   | e1RM, progression, fatigue, deload, missed-session and specialization logic    | Complete        |
| E4   | Manage, preview, perform, offline logging, explainability, swaps and analytics | Complete        |
| E5   | Billing, paywall and GDPR export                                               | Not implemented |
| E6   | Powerlifting, advanced set methods, travel and authored routines               | Not implemented |

## E2 Pipeline

The implemented order matches the design:

1. Routine selection follows the persisted split rotation.
2. Muscle allocation uses training age, remaining weekly hard sets, fatigue,
   frequency and specialization.
3. Exercise selection filters by equipment, injury constraints, rep suitability
   and stimulus quality.
4. Set, rep and load prescription applies the active versioned rule set.
5. Ordering prioritizes specialization and compound work.
6. Time fitting trims lower-priority volume to the available session budget.

Every stage emits rationale tags and the final plan is immutable. Identical
athlete state, context and rule-set version produce identical output.

## Current Hypertrophy Defaults

- Weekly hard-set targets: beginner `4–10`, intermediate `8–15`, advanced
  `11–18` per muscle.
- Specialization ceilings: `10`, `20` and `30` sets respectively.
- Practical rep range: `5–15`.
- Normal effort: `0–2 RIR`; the last working set of each exercise targets
  `0.5 RIR`.
- Rest: at least `90s` for isolation work and `150s` for compound work.
- Primary muscle credit: `1.0`; secondary muscle credit: `0.5`.
- Guided session budget: minimum `45` minutes.
- Time estimates include warm-up, setup, execution and rest.

## Session Preferences

The user controls session size without bypassing scientific or recovery limits:

| UI option       | Meaning                                            |
| --------------- | -------------------------------------------------- |
| 3 — Short       | Minimum effective dose                             |
| 5 — Recommended | Default balance for most users                     |
| 6 — More        | More variety for experienced, well-recovered users |

The detailed profile supports `2–8` exercises. The engine treats this as a
preference, not an unconditional promise: time, equipment, injuries, available
exercise variations and safe set allocation can reduce the final count.

## Full-Body Allocation

For full-body sessions, ties are resolved by movement importance rather than
alphabetical muscle name. The default priority is:

`chest → lats/back → quads/legs → shoulders → biceps → triceps`

Smaller direct targets such as forearms, calves or abs are considered after the
major movement groups, unless the athlete explicitly specializes them. Compound
exercise secondary-muscle credit still contributes to arms and related muscles.

## Client Flow

The design's `Plan → Preview → Perform` concept is presented in the product as:

`Program → Manage → Perform → Progress`

`Manage my week` opens the generated week. Each day can be previewed, adjusted,
swapped and then performed. Set logs are written locally first and synchronized
idempotently when connectivity is available.

## Verification

The repository quality gate is:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Engine coverage includes deterministic output, rule-set compatibility, injury
and equipment filtering, time fitting, session-size preferences, final-set RIR
and full-body major-muscle prioritization.
