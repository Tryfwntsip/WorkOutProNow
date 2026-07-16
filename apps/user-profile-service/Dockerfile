# ── Build stage ──────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/observability/package.json packages/observability/
COPY packages/http-kit/package.json packages/http-kit/
COPY apps/user-profile-service/package.json apps/user-profile-service/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @myoadapt/user-profile-service... build

# ── Runtime stage ────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/user-profile-service ./apps/user-profile-service
COPY --from=build /app/package.json ./package.json

WORKDIR /app/apps/user-profile-service
EXPOSE 4002
CMD ["node", "--import", "./dist/tracing.js", "dist/index.js"]
