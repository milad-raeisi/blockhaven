# Optional container image for the Blockhaven server (Next.js + WebSocket game server).
# Used by `docker compose --profile app up -d --build`.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
# Apply pending migrations, then start the server.
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
