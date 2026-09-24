# Multi-stage production build for OceanGuard AI
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install -g pnpm && pnpm install --prod --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build ./build

# Durable data directory for operational JSON + simulation replay archives
# (mounted as a volume in docker-compose so restarts keep saved surveys).
RUN mkdir -p /app/data
ENV OCEANGUARD_WEB_DATA_DIR=/app/data
ENV SIM_REPLAY_DIR=/app/data/simulation-replays

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build/server.cjs"]
