FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:aws

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app/aws
COPY aws/package.json aws/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/aws/dist ./dist
COPY aws/server.mjs aws/sqlite-store.mjs aws/dynamo-store.mjs ./
COPY core /app/core
RUN mkdir -p /app/data && chown node:node /app/data
USER node
WORKDIR /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","aws/server.mjs"]
