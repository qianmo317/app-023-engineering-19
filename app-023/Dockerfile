# 多阶段构建：node 构建 → nginx 仅拷 dist（镜像 < 60MB）
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# alpine-slim（无 njs/动态模块）：基底 ~41MB，含 dist 总体 < 60MB 达标；
# 完整版 nginx:1.27-alpine 基底 78MB，超出验收线
FROM nginx:1.27-alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://localhost/healthz || exit 1
EXPOSE 80
