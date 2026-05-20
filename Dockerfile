FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

RUN npm install --include=dev --no-audit --no-fund --workspace @contentflow/api

COPY packages/api ./packages/api

RUN npm --workspace @contentflow/api run build

EXPOSE 5000

CMD ["node", "packages/api/.railway-build/server.mjs"]
