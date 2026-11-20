# syntax=docker/dockerfile:1
# Multi-stage build. Targets:
#   runtime (default, last stage) - the app: API + built frontend, production dependencies plus the Prisma CLI, non-root.
#                       It can apply migrations itself: `npx prisma migrate deploy` (a platform pre-deploy step), or set
#                       MIGRATE_ON_START=true. Platforms that build the Dockerfile's last stage (Railway) get this one.
#   migrate           - a separate image that only applies migrations, for pipelines that prefer to keep that step apart.

FROM node:22-bookworm-slim AS build
# A dropped connection to the npm registry should be retried, not fail the whole build.
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=2000 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prisma.config.ts reads DATABASE_URL when it loads (and the build scripts run `prisma generate` themselves), so export a
# placeholder for this one step only. Nothing connects to it, and it is not left in the image environment.
RUN export DATABASE_URL=postgresql://build:build@localhost:5432/build \
 && npx prisma generate \
 && npm run build \
 && npm run build:server

FROM node:22-bookworm-slim AS prod-deps
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=2000 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 # The Prisma CLI is a dev dependency (it generates the client at build time) but the running image also needs it to
 # apply migrations. Install exactly the version the project pins.
 && npm install --omit=dev --no-save --no-audit --no-fund "prisma@$(node -p "require('./package.json').devDependencies.prisma")"

FROM build AS migrate
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 STATIC_DIR=/app/dist EXPORT_DIR=/data/exports
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY server/db/schema.prisma ./server/db/schema.prisma
COPY server/db/migrations ./server/db/migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# Generated files (exports) are written here. Mount a persistent volume; the app does not need to write anywhere else.
RUN chmod 755 ./docker-entrypoint.sh && mkdir -p /data/exports && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
