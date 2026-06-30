# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/types/package.json      ./packages/types/package.json
COPY packages/dashboard/package.json  ./packages/dashboard/package.json

RUN npm ci

COPY packages/types/     ./packages/types/
COPY packages/dashboard/ ./packages/dashboard/

# Build types then dashboard
RUN npm run build --workspace=packages/types
RUN npm run build --workspace=packages/dashboard

# ── Stage 2: nginx serving ────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Copy the built React app
COPY --from=builder /app/packages/dashboard/dist /usr/share/nginx/html

# nginx config: serve SPA (all routes → index.html), proxy /api to the server
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost/health || exit 1
