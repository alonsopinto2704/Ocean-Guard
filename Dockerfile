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
COPY --from=builder /app/dist/server.cjs ./server.cjs

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
