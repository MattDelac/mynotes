# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
ARG PUBLIC_API_URL
ENV PUBLIC_API_URL=$PUBLIC_API_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
RUN corepack enable && pnpm install --frozen-lockfile
COPY apps/web/ ./apps/web/
RUN pnpm --filter web build

# Stage 2: Serve (unprivileged nginx — runs as uid 101, listens on 8080)
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY --from=build /app/apps/web/build /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
