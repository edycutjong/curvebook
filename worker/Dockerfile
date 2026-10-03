FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY core/package.json core/
COPY worker/package.json worker/
RUN pnpm install --frozen-lockfile --filter @curvebook/worker... --ignore-scripts
COPY core core
COPY worker worker
COPY db db
ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@curvebook/worker", "start"]
