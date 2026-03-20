FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY services/svc-productos/package.json ./services/svc-productos/
RUN npm ci --workspaces --include-workspace-root

# ─── Build packages ───────────────────────────────────────────────────────────
FROM deps AS build-shared
COPY packages/shared-types ./packages/shared-types
RUN npm run build --workspace=packages/shared-types
COPY packages/event-bus ./packages/event-bus
RUN npm run build --workspace=packages/event-bus

# ─── Build service ────────────────────────────────────────────────────────────
FROM build-shared AS build-svc
COPY services/svc-productos ./services/svc-productos
RUN npm run build --workspace=services/svc-productos

# ─── Production image ─────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY --from=build-shared /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build-shared /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=build-shared /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=build-shared /app/packages/event-bus/package.json ./packages/event-bus/
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
