# ── Build stage ──────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app

RUN corepack enable

# Workspace manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/observability/package.json packages/observability/
COPY packages/http-kit/package.json packages/http-kit/
COPY apps/identity-service/package.json apps/identity-service/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @myoadapt/identity-service... build

# ── Runtime stage ────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/identity-service ./apps/identity-service
COPY --from=build /app/package.json ./package.json

WORKDIR /app/apps/identity-service
EXPOSE 4001
CMD ["node", "--import", "./dist/tracing.js", "dist/index.js"]
