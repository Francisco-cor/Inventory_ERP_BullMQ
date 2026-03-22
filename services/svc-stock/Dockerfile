FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init curl

FROM base AS deps
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY services/svc-stock/package.json ./services/svc-stock/
RUN npm ci --workspaces --include-workspace-root

FROM deps AS build-shared
COPY packages/shared-types ./packages/shared-types
RUN npm run build --workspace=packages/shared-types
COPY packages/event-bus ./packages/event-bus
RUN npm run build --workspace=packages/event-bus

FROM build-shared AS build-svc
COPY services/svc-stock ./services/svc-stock
RUN npm run build --workspace=services/svc-stock

FROM base AS production
ENV NODE_ENV=production

COPY --from=build-shared /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build-shared /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build-shared /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=build-shared /app/packages/event-bus/package.json ./packages/event-bus/
COPY --from=build-svc    /app/services/svc-stock/dist ./services/svc-stock/dist
COPY --from=build-svc    /app/services/svc-stock/migrations ./services/svc-stock/migrations
COPY --from=build-svc    /app/services/svc-stock/package.json ./services/svc-stock/
COPY --from=deps         /app/node_modules ./node_modules
COPY package.json ./

WORKDIR /app/services/svc-stock
EXPOSE 3003

USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
