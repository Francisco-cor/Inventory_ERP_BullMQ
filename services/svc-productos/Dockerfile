FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init curl

FROM base AS deps
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY packages/env/package.json ./packages/env/
COPY packages/auth/package.json ./packages/auth/
COPY packages/db-migrate/package.json ./packages/db-migrate/
COPY packages/resilience/package.json ./packages/resilience/
COPY packages/logger/package.json ./packages/logger/
COPY packages/metrics/package.json ./packages/metrics/
COPY packages/tracing/package.json ./packages/tracing/
COPY services/svc-productos/package.json ./services/svc-productos/
RUN npm ci --workspaces --include-workspace-root

FROM deps AS build-shared
COPY packages/shared-types ./packages/shared-types
RUN npm run build --workspace=packages/shared-types
COPY packages/event-bus ./packages/event-bus
RUN npm run build --workspace=packages/event-bus
COPY packages/env ./packages/env
RUN npm run build --workspace=@erp/env
COPY packages/auth ./packages/auth
RUN npm run build --workspace=@erp/auth
COPY packages/db-migrate ./packages/db-migrate
RUN npm run build --workspace=@erp/db-migrate
COPY packages/resilience ./packages/resilience
RUN npm run build --workspace=@erp/resilience
COPY packages/logger ./packages/logger
RUN npm run build --workspace=@erp/logger
COPY packages/metrics ./packages/metrics
RUN npm run build --workspace=@erp/metrics
COPY packages/tracing ./packages/tracing
RUN npm run build --workspace=@erp/tracing

FROM build-shared AS build-svc
COPY services/svc-productos ./services/svc-productos
RUN npm run build --workspace=services/svc-productos

FROM base AS production
ENV NODE_ENV=production

COPY --from=build-shared /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build-shared /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build-shared /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=build-shared /app/packages/event-bus/package.json ./packages/event-bus/
COPY --from=build-shared /app/packages/env/dist ./packages/env/dist
COPY --from=build-shared /app/packages/env/package.json ./packages/env/
COPY --from=build-shared /app/packages/auth/dist ./packages/auth/dist
COPY --from=build-shared /app/packages/auth/package.json ./packages/auth/
COPY --from=build-shared /app/packages/db-migrate/dist ./packages/db-migrate/dist
COPY --from=build-shared /app/packages/db-migrate/package.json ./packages/db-migrate/
COPY --from=build-shared /app/packages/resilience/dist ./packages/resilience/dist
COPY --from=build-shared /app/packages/resilience/package.json ./packages/resilience/
COPY --from=build-shared /app/packages/logger/dist ./packages/logger/dist
COPY --from=build-shared /app/packages/logger/package.json ./packages/logger/
COPY --from=build-shared /app/packages/metrics/dist ./packages/metrics/dist
COPY --from=build-shared /app/packages/metrics/package.json ./packages/metrics/
COPY --from=build-shared /app/packages/tracing/dist ./packages/tracing/dist
COPY --from=build-shared /app/packages/tracing/package.json ./packages/tracing/
COPY --from=build-svc    /app/services/svc-productos/dist ./services/svc-productos/dist
COPY --from=build-svc    /app/services/svc-productos/migrations ./services/svc-productos/migrations
COPY --from=build-svc    /app/services/svc-productos/package.json ./services/svc-productos/
COPY --from=deps         /app/node_modules ./node_modules
COPY package.json ./

WORKDIR /app/services/svc-productos
EXPOSE 3001

USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
