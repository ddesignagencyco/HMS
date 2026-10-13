# SHM-094 · TRD §21 — production images.
#
# One codebase, two deployable processes (TRD §3: a modular monolith whose API and worker
# are separate npm-workspace packages, deployed and scaled independently). Both are built
# from this single multi-stage file so the two images can never drift, and a third target
# (`migrate`) carries the release-step migration tooling without any of it reaching the
# runtime images.
#
#   docker build --target api    -t <registry>/api:<tag>    .
#   docker build --target worker -t <registry>/worker:<tag> .
#   docker build --target migrate -t <registry>/migrate:<tag> .
#
# Non-root throughout the runtime stages: the `node` user the official image already
# defines (uid 1000). No compiler, no package manager on the hot path.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    # The Prisma client is generated explicitly in the `build` stage; letting the
    # postinstall try (and warn) on every `npm ci` buys nothing.
    PRISMA_SKIP_POSTINSTALL_GENERATE=true
WORKDIR /app

# --- dependencies: cached on the lockfile alone, invalidated only when it changes ------
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN npm ci

# --- build: generate the Prisma client, then compile every workspace -------------------
FROM deps AS build
# openssl is what Prisma's query engines link against; ca-certificates for npm.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run db:generate --workspace @smart-home/db \
 && npm run build

# --- production dependencies only: no dev tooling in the runtime images ----------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN npm ci --omit=dev

# --- runtime: non-root, no toolchain, shared by the api and worker targets --------------
FROM base AS runtime
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Production node_modules, with the client the build stage generated laid over the bare
# @prisma/client that npm installed. Without this the app boots and every query fails with
# "did you run prisma generate?".
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

# Compiled workspaces and their manifests. The workspace symlinks in node_modules point
# here, so each package's dist/ and package.json must exist for resolution to work.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=node:node /app/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /app/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist

USER node

FROM runtime AS api
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
EXPOSE 9464
CMD ["node", "apps/worker/dist/worker.js"]

# The release step. Keeps the dev dependencies (dbmate + the SQL under
# packages/db/migrations) precisely because they are what applies the schema; it is a
# one-shot job, never a long-running service. `DBMATE_COMMAND` selects up/status/etc.
FROM build AS migrate
CMD ["node", "packages/db/scripts/dbmate.mjs"]
