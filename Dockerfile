# syntax=docker/dockerfile:1
# Multi-stage build. Targets:
#   runtime (default) - the app: API + built frontend, production dependencies only, runs as a non-root user.
#   migrate           - applies database migrations (`prisma migrate deploy`); run it as a release step before the new app version.

FROM node:22-bookworm-slim AS build
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
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM build AS migrate
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 STATIC_DIR=/app/dist EXPORT_DIR=/data/exports
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/dist ./dist
COPY package.json ./
# Generated files (exports) are written here. Mount a persistent volume; the app does not need to write anywhere else.
RUN mkdir -p /data/exports && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
