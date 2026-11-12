# syntax=docker/dockerfile:1
#
# RAGE API (NestJS) image. Build from the REPOSITORY ROOT:
#   docker build -f apps/api/Dockerfile --target runtime -t rage/api:local .
#   docker build -f apps/api/Dockerfile --target migrate -t rage/api-tools:local .
#
# Targets:
#   runtime — minimal production image: `node dist/main.js`, non-root, no pnpm, no dev deps.
#   migrate — tooling image (full workspace deps for @rage/api + @rage/db) that runs
#             `prisma migrate deploy` via `pnpm --filter @rage/db migrate:deploy`.
# No secrets are baked into any layer: all credentials arrive as runtime env vars.

ARG PNPM_VERSION=11.1.3

# ---------------------------------------------------------------------------------
FROM node:24.22.2-trixie-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    TURBO_TELEMETRY_DISABLED=1
ENV PATH=${PNPM_HOME}:${PATH}
# openssl + ca-certificates: Prisma's schema engine (used by `migrate deploy`) links
# against libssl; ca-certificates for corepack / engine downloads.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && chmod -R a+rX "${COREPACK_HOME}" \
 && pnpm --version
WORKDIR /app

# ---------------------------------------------------------------------------------
# Download every package in the lockfile into the pnpm store (cached between builds).
# Only the lockfile + workspace manifest are copied, so this layer survives source edits.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=rage-pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

# ---------------------------------------------------------------------------------
FROM fetch AS build
COPY . .
# Install only @rage/api and its workspace dependencies (e.g. @rage/db) from the store.
RUN --mount=type=cache,id=rage-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store --filter "@rage/api..."
# `prisma generate` does not connect to the database, but prisma.config may require
# DATABASE_URL to be defined. This placeholder is NOT a credential and is scoped to
# this RUN only (not persisted into the image environment).
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    pnpm --filter @rage/db run generate \
 && pnpm --filter "@rage/api..." run build \
 && test -f apps/api/dist/main.js

# ---------------------------------------------------------------------------------
# Tooling image used by the compose `migrate` / `seed` one-shot services.
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@rage/db", "migrate:deploy"]

# ---------------------------------------------------------------------------------
# Self-contained production tree: apps/api files + prod node_modules, with workspace
# packages copied in (legacy deploy: the workspace does not set injectWorkspacePackages).
FROM build AS deploy
RUN --mount=type=cache,id=rage-pnpm-store,target=/pnpm/store \
    pnpm --filter @rage/api deploy --prod --legacy --offline --store-dir /pnpm/store /out \
 && test -f /out/dist/main.js \
 && cd /out \
 && node --input-type=module -e "console.log('resolved @rage/db ->', import.meta.resolve('@rage/db'))" \
 && rm -rf /out/src /out/test /out/*.config.ts /out/tsconfig*.json /out/.swcrc

# ---------------------------------------------------------------------------------
FROM node:24.22.2-trixie-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000
WORKDIR /app
COPY --from=deploy --chown=node:node /out ./
USER node
EXPOSE 4000
# Liveness only (process up). Readiness (DB/Redis) is /api/v1/health/ready.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
