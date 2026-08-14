# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
RUN corepack enable && pnpm install --frozen-lockfile
COPY apps/web/ ./apps/web/
RUN pnpm --filter web build

# Stage 2: Serve
FROM nginx:1.29-alpine
COPY --from=build /app/apps/web/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
