# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root manifests first (for npm ci caching)
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/types/package.json   ./packages/types/package.json
COPY packages/server/package.json  ./packages/server/package.json

# Install all workspace deps
RUN npm ci

# Copy source
COPY packages/types/   ./packages/types/
COPY packages/server/  ./packages/server/

# Build types first (server depends on it)
RUN npm run build --workspace=packages/types
RUN npm run build --workspace=packages/server

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Only copy what's needed to run
COPY --from=builder /app/package.json             ./package.json
COPY --from=builder /app/package-lock.json        ./package-lock.json
COPY --from=builder /app/packages/types/package.json    ./packages/types/package.json
COPY --from=builder /app/packages/types/dist            ./packages/types/dist
COPY --from=builder /app/packages/server/package.json   ./packages/server/package.json
COPY --from=builder /app/packages/server/dist           ./packages/server/dist

# Install production deps only
RUN npm ci --omit=dev --workspace=packages/server --workspace=packages/types

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
