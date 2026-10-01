# ReplayHaven archive server: web UI + upload API + SQLite + FFmpeg in one image.
# Base images are pinned by digest in the FROM lines themselves, where Dependabot updates them.

# The build stage always runs on the host architecture. Its output is plain
# JavaScript, so multi-arch images only have to install runtime dependencies.
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm run server:bundle

# Alpine keeps the runtime small: FFmpeg with its libraries is far lighter than on Debian.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
ARG REPLAYHAVEN_VERSION=dev
# Baked in by the release workflow so the "Download Windows client" button works
# out of the box. Stored under its own name so an empty REPLAYHAVEN_CLIENT_DOWNLOAD_URL
# (e.g. a blank line in .env) cannot switch it off; that variable still overrides it.
ARG REPLAYHAVEN_CLIENT_DOWNLOAD_URL=""
LABEL org.opencontainers.image.title="ReplayHaven" \
      org.opencontainers.image.description="Self-hosted game clip archive: web UI, upload API, SQLite and FFmpeg" \
      org.opencontainers.image.version="${REPLAYHAVEN_VERSION}" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
      org.opencontainers.image.source="https://github.com/SauerExe/ReplayHaven"
RUN apk add --no-cache ffmpeg tini ca-certificates
WORKDIR /app
COPY package.json package-lock.json ./
# The npm FFmpeg packages are only a fallback when REPLAYHAVEN_FFMPEG/FFPROBE are unset
# (server/media.ts requires them lazily). The image sets both to Alpine's ffmpeg, so drop them.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
 && rm -rf node_modules/ffmpeg-static node_modules/@ffprobe-installer
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-bundle ./server-bundle
RUN mkdir -p /app/vault-data /app/release && chown -R node:node /app/vault-data /app/release
USER node
ENV NODE_ENV=production \
    REPLAYHAVEN_HOST=0.0.0.0 \
    REPLAYHAVEN_PORT=8787 \
    REPLAYHAVEN_DATA_DIR=/app/vault-data \
    REPLAYHAVEN_RELEASE_DIR=/app/release \
    REPLAYHAVEN_FFMPEG=/usr/bin/ffmpeg \
    REPLAYHAVEN_FFPROBE=/usr/bin/ffprobe \
    REPLAYHAVEN_AI_PROVIDER=none \
    REPLAYHAVEN_VERSION=${REPLAYHAVEN_VERSION} \
    REPLAYHAVEN_RELEASE_DOWNLOAD_URL=${REPLAYHAVEN_CLIENT_DOWNLOAD_URL}
VOLUME ["/app/vault-data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/status').then(r=>process.exit(r.status===200||r.status===401?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server-bundle/index.mjs"]
