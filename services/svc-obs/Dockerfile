FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init curl

FROM base AS deps
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY services/svc-obs/package.json ./services/svc-obs/
RUN npm ci --workspaces --include-workspace-root

FROM deps AS build-shared
COPY packages/shared-types ./packages/shared-types
RUN npm run build --workspace=packages/shared-types
COPY packages/event-bus ./packages/event-bus
RUN npm run build --workspace=packages/event-bus

FROM build-shared AS build-svc
COPY services/svc-obs ./services/svc-obs
RUN npm run build --workspace=services/svc-obs

FROM base AS production
ENV NODE_ENV=production

COPY --from=build-shared /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build-shared /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build-shared /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=build-shared /app/packages/event-bus/package.json ./packages/event-bus/
COPY --from=build-svc    /app/services/svc-obs/dist ./services/svc-obs/dist
COPY --from=build-svc    /app/services/svc-obs/migrations ./services/svc-obs/migrations
COPY --from=build-svc    /app/services/svc-obs/package.json ./services/svc-obs/
COPY --from=deps         /app/node_modules ./node_modules
COPY package.json ./

WORKDIR /app/services/svc-obs
EXPOSE 3004

USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
