# syntax=docker/dockerfile:1
#
# RAGE Web (Next.js, `output: 'standalone'`) image. Build from the REPOSITORY ROOT:
#   docker build -f apps/web/Dockerfile --target runtime \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 \
#     --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
#     -t rage/web:local .
#
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are
# build args (public, non-secret). Server-only settings such as API_INTERNAL_URL are
# read at runtime from the container environment. No secrets are baked into layers.

ARG PNPM_VERSION=11.1.3

# ---------------------------------------------------------------------------------
FROM node:26.13.0-trixie-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
ENV PATH=${PNPM_HOME}:${PATH}
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && chmod -R a+rX "${COREPACK_HOME}" \
 && pnpm --version
WORKDIR /app

# ---------------------------------------------------------------------------------
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=rage-pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

# ---------------------------------------------------------------------------------
FROM fetch AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
# NOTE: do not set NODE_ENV=production before `pnpm install` — pnpm would skip the
# devDependencies (TypeScript, Tailwind, ...) that `next build` needs. Next sets it itself.
COPY . .
RUN --mount=type=cache,id=rage-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store --filter "@rage/web..."
# The typed API client (packages/api-client) is generated from the committed OpenAPI
# document and checked into git (CI fails on drift), so it is built, not regenerated.
RUN pnpm --filter "@rage/web..." run build \
 && test -f apps/web/.next/standalone/apps/web/server.js \
 && mkdir -p apps/web/public

# ---------------------------------------------------------------------------------
FROM node:26.13.0-trixie-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone output traced from the monorepo root: server lives at apps/web/server.js.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# Any non-5xx answer from the Next server means the process is serving requests.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "apps/web/server.js"]
