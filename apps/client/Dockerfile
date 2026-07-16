FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/science/package.json packages/science/
COPY packages/db/package.json packages/db/
COPY packages/config/package.json packages/config/
COPY packages/client/package.json packages/client/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @myoadapt/client-app... build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/client ./packages/client
COPY --from=build /app/apps/client ./apps/client
COPY --from=build /app/package.json ./package.json
WORKDIR /app/apps/client
EXPOSE 3000
CMD ["node", "dist/index.js"]
