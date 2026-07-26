FROM node:24.11.1-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM base AS web-build
ARG NEXT_PUBLIC_APP_NAME=超级画布
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
RUN pnpm --filter @super-canvas/web... build

FROM web-build AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN CI=true pnpm prune --prod
RUN mkdir -p /app/apps/web/storage \
  && chown -R node:node /app/apps/web/.next /app/apps/web/storage
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]

FROM base AS worker-build
RUN pnpm --filter @super-canvas/worker... build

FROM worker-build AS worker
ENV NODE_ENV=production
RUN CI=true pnpm prune --prod
RUN mkdir -p /app/apps/worker/storage \
  && chown -R node:node /app/apps/worker/dist /app/apps/worker/storage
WORKDIR /app/apps/worker
USER node
CMD ["node", "dist/index.js"]
