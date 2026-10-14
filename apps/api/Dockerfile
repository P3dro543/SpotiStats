FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @spotify-stats/api build
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @spotify-stats/api db:deploy && pnpm --filter @spotify-stats/api start"]
