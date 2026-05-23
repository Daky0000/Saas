# ── Builder: compile TypeScript with dev dependencies ─────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

RUN npm install --include=dev --no-audit --no-fund --workspace @contentflow/api

COPY packages/api ./packages/api

RUN npm --workspace @contentflow/api run build

# ── Final image: production dependencies + compiled output only ────────────────
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

RUN npm install --omit=dev --no-audit --no-fund --workspace @contentflow/api

COPY --from=builder /app/packages/api/.railway-build ./packages/api/.railway-build

EXPOSE 5000

CMD ["node", "packages/api/.railway-build/server.mjs"]
