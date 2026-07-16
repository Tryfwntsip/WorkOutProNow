FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/science/package.json packages/science/
COPY packages/observability/package.json packages/observability/
COPY packages/http-kit/package.json packages/http-kit/
COPY apps/engine-service/package.json apps/engine-service/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @myoadapt/engine-service... build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/engine-service ./apps/engine-service
COPY --from=build /app/package.json ./package.json
WORKDIR /app/apps/engine-service
EXPOSE 4003
CMD ["node", "--import", "./dist/tracing.js", "dist/index.js"]
