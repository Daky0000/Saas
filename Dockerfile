# ── Stage 1: Build web frontend ───────────────────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /app

COPY package*.json ./
COPY packages/web/package*.json ./packages/web/

RUN npm install --include=dev --no-audit --no-fund --workspace @contentflow/web

COPY packages/web ./packages/web

# VITE_* vars are baked in at build time; if unset, relative paths are used (same-origin)
ARG VITE_API_BASE_URL
ARG VITE_APP_URL
ARG VITE_INSTAGRAM_APP_ID
ARG VITE_TWITTER_CLIENT_ID
ARG VITE_LINKEDIN_CLIENT_ID
ARG VITE_FACEBOOK_APP_ID
ARG VITE_TIKTOK_CLIENT_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_APP_URL=$VITE_APP_URL \
    VITE_INSTAGRAM_APP_ID=$VITE_INSTAGRAM_APP_ID \
    VITE_TWITTER_CLIENT_ID=$VITE_TWITTER_CLIENT_ID \
    VITE_LINKEDIN_CLIENT_ID=$VITE_LINKEDIN_CLIENT_ID \
    VITE_FACEBOOK_APP_ID=$VITE_FACEBOOK_APP_ID \
    VITE_TIKTOK_CLIENT_ID=$VITE_TIKTOK_CLIENT_ID

RUN npm run build --workspace @contentflow/web

# ── Stage 2: Compile API TypeScript ───────────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /app

COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

RUN npm install --include=dev --no-audit --no-fund --workspace @contentflow/api

COPY packages/api ./packages/api
COPY scripts ./scripts

RUN npm --workspace @contentflow/api run build

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

RUN npm install --omit=dev --no-audit --no-fund --workspace @contentflow/api

COPY --from=api-builder /app/packages/api/.railway-build ./packages/api/.railway-build
COPY --from=web-builder /app/packages/web/dist ./packages/api/.railway-build/public

EXPOSE 5000

CMD ["node", "packages/api/.railway-build/server.mjs"]
