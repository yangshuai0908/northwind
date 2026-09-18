# DEMO1 启动说明

项目分为两部分：

| 目录 | 技术栈 | 默认端口 |
| --- | --- | --- |
| `backend/` | Node.js + Express 5 + TypeScript（tsx 运行） | 1997 |
| `frontend/` | React 19 + Vite | 5173 |

## 环境要求

- Node.js >= 20（当前开发环境为 v22.19.0）
- npm
- 可访问的 PostgreSQL 数据库（项目使用 Neon，连接串配置在 `DATABASE_URL`）

## 一、安装依赖

需要分别在两个目录下安装，根目录下没有统一的 workspace 配置。

```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install
```

## 二、配置后端环境变量

后端启动时会用 zod 校验环境变量，缺失或不合法会直接抛错退出，因此这一步必须先完成。

在 `backend/` 目录下创建 `.env`（可参考 `backend/.env.example`）：

```env
PORT=1997
NODE_ENV=development

DATABASE_URL=postgresql://<用户>:<密码>@<主机>/<库名>?sslmode=require

CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
CLERK_WEBHOOK_SECRET=whsec_xxx

FRONTEND_URL=http://localhost:5173

POLAR_ACCESS_TOKEN=xxx
POLAR_WEBHOOK_SECRET=xxx
POLAR_API_BASE=https://sandbox-api.polar.sh
POLAR_CHECKOUT_PRODUCT_ID=xxx

STREAM_API_KEY=xxx
STREAM_API_SECRET=xxx

IMAGEKIT_PUBLIC_KEY=public_xxx
IMAGEKIT_PRIVATE_KEY=private_xxx
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/xxx

SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

注意事项：

- **变量名必须完全一致**。例如写成 `FRONTED_URL` 会导致校验失败，报错 `{ FRONTEND_URL: [ 'Required' ] }`。
- `POLAR_API_BASE` 不要写成 `POLAR_API_BASE_URL`，后者不会被读取，会回落到默认值（生产地址）。
- `NODE_ENV`、`PORT`、`POLAR_API_BASE` 有默认值，可不填；其余未标注 optional 的字段均为必填。
- `.env` 含明文密钥，**不要提交到仓库**。

## 三、启动开发环境

需要两个终端窗口：

```bash
# 终端 1：后端
cd backend
npm run dev
```

看到 `Server running on port 1997` 即启动成功（`tsx watch` 会在文件改动时自动重启）。

```bash
# 终端 2：前端
cd frontend
npm run dev
```

看到 `Local: http://localhost:5173/` 即启动成功。

浏览器访问 http://localhost:5173 即可。

## 四、生产构建

```bash
# 后端：TypeScript 编译到 dist/
cd backend
npm run build
npm start          # 等价于 node dist/index.js

# 前端：构建静态资源到 dist/
cd frontend
npm run build
npm run preview    # 本地预览构建产物
```

## 五、其他常用命令

```bash
cd backend
npm run dev        # tsx watch src/index.ts，开发热重载
npm run build      # tsc 编译
npm start          # 运行编译产物

cd frontend
npm run lint       # ESLint 检查
```

## 常见问题

**启动时报 `Invalid environment variables`**

查看控制台上方打印的字段错误列表（如 `{ FRONTEND_URL: [ 'Required' ] }`），对照 `backend/src/lib/env.ts` 补齐或修正 `.env` 中的变量名与格式（`FRONTEND_URL`、`IMAGEKIT_URL_ENDPOINT`、`SENTRY_DSN` 需为合法 URL）。

**端口被占用**

修改 `.env` 中的 `PORT`（后端），或前端启动时指定 `npm run dev -- --port 5174`。

**前端请求后端接口跨域**

后端已启用 `cors()` 且默认允许所有来源；若前端端口变更，需同步更新 `.env` 中的 `FRONTEND_URL`。
