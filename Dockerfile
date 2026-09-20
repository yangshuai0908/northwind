# 单体镜像：Vite 前端 + Express 后端 API
# 注意：必须在仓库根目录执行构建（docker build -f Dockerfile .），因为 COPY 使用的是 frontend/ 与 backend/ 相对路径。

# --- 阶段 1：构建前端 SPA（Vite）---
# 产物为 dist/ 下的静态 HTML/JS/CSS，最终会被复制到运行镜像的 ./public 目录。
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/ ./
# 留空 = 浏览器请求 /api 时使用与页面相同的域名（即与 Express 同源），无需跨域配置。
ENV VITE_API_URL=
# Clerk 公钥：可以安全地作为构建参数传入，因为它本来就会被打包进客户端 JS 中。
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm install --no-audit --no-fund \
  && npm run build

# --- 阶段 2：编译后端 API（TypeScript → JavaScript）---
# 产物为 dist/ 下的 index.js 及其余服务端文件。
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app
COPY backend/ ./
# 此处安装的是全部依赖（含 devDependencies），因为 tsc 编译需要它们。
RUN npm install --no-audit --no-fund \
  && npm run build

# --- 阶段 3：运行镜像（仅保留生产依赖 + 构建产物）---
# Express 同时提供 API 路由与 public/ 下的静态文件（即阶段 1 的 Vite 产物）。
# 多阶段构建的目的：不把源码、编译工具链和 devDependencies 带进最终镜像，显著减小体积。
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# 只装生产依赖，装完清理 npm 缓存以进一步瘦身
COPY backend/package.json backend/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# 从各构建阶段只拷贝产物，不拷贝 node_modules 与源码
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

# EXPOSE 3001
EXPOSE 1998
# 以非 root 用户运行，降低容器内权限
USER node

CMD ["node", "dist/index.js"]
