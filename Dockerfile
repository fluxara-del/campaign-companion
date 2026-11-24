# syntax=docker/dockerfile:1.7
# Kronike Devet Zvona — Campaign Companion
# Bazna slika zaključana digestom (Dependabot je ažurira kroz PR).
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-fund --no-audit
COPY . .
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA}
RUN npm run build && npm prune --omit=dev --no-fund --no-audit

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG MIGRATIONS_HEAD=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    DATABASE_URL=file:/data/app.db \
    BACKUP_DIR=/backups

LABEL org.opencontainers.image.title="campaign-companion" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      io.kdz.migrations.head="${MIGRATIONS_HEAD}"

# Kod je u vlasništvu roota (read-only za proces); aplikacija radi kao korisnik `node` (uid 1000).
COPY --from=build /app/package.json /app/package-lock.json /app/prisma.config.ts /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /data /backups /app/.next/cache \
    && chown node:node /data /backups /app/.next/cache

USER node
VOLUME ["/data", "/backups"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start"]
