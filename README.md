# Northwind 电商 Demo

一个前后端分离的商品售卖 Demo：商品目录 / 购物车 / 在线支付 / 订单 / 售后会话（聊天 + 视频）。

## 技术栈

| 目录 | 技术栈 | 默认端口 |
| --- | --- | --- |
| `backend/` | Node.js + Express + TypeScript（tsx 运行） + Drizzle ORM + PostgreSQL | 1997（当前 `.env` 设为 1998） |
| `frontend/` | React 19 + Vite + React Router 7 + TanStack Query v5 + Zustand + Tailwind 4 / daisyUI | 5173 |

### 外部服务

| 服务 | 用途 |
| --- | --- |
| **Clerk** | 用户认证（应用不存密码），通过 `clerkUserId` 与本地 `users` 表关联 |
| **Neon** | PostgreSQL 数据库 |
| **Polar** | 支付（沙箱 `https://sandbox-api.polar.sh`） |
| **Stream** | 售后聊天频道与视频通话 |
| **ImageKit** | 商品图片存储与 CDN |
| **Sentry** | 前后端错误上报、性能追踪、会话回放 |

## 项目目录

```
DEMO1/
├── Dockerfile                  # 多阶段构建：前端 → 后端 → 生产镜像
├── README.md
├── Git推送说明.md
│
├── backend/
│   ├── drizzle.config.ts       # drizzle-kit 迁移配置
│   ├── tsconfig.json
│   ├── package.json
│   ├── scripts/
│   │   └── seed.ts             # 种子数据
│   └── src/
│       ├── index.ts            # 应用入口：中间件、路由挂载、静态托管与 SPA 兜底
│       ├── instrument.ts       # Sentry 初始化
│       ├── db/
│       │   ├── index.ts        # pg 连接池 + drizzle 实例
│       │   └── schema.ts       # 表结构与关系定义（users/products/checkout_sessions/orders/order_items）
│       ├── routes/             # 路由注册
│       │   ├── meRouter.ts         # GET    /api/me
│       │   ├── productRouter.ts    # GET    /api/products、/categories、/:slug
│       │   ├── chekoutRouter.ts    # POST   /api/checkout
│       │   ├── orderRouter.ts      # GET    /api/orders、/:id；POST /:id/stream-channel、/:id/video-invite
│       │   ├── adminRouter.ts      # GET/POST/PATCH/DELETE /api/admin/products；GET /imagekit/auth
│       │   └── streamRouter.ts     # POST   /api/stream/token
│       ├── controllers/        # 业务逻辑
│       ├── lib/
│       │   ├── env.ts              # zod 环境变量校验
│       │   ├── polar.ts            # Polar 结算会话创建
│       │   ├── stream.ts           # Stream 用户/频道
│       │   ├── imagekit.ts         # 图片上传签名
│       │   ├── users.ts            # Clerk ID → 本地用户
│       │   ├── roles.ts            # 角色判断（isStaff）
│       │   └── cron.ts             # 生产环境保活定时任务
│       ├── webhooks/
│       │   ├── clerk.ts            # 用户同步（创建/更新/删除）
│       │   └── polar.ts            # 支付回调履约：checkout_sessions → orders
│       └── middleware/
│           └── sentryClerkUser.ts
│
└── frontend/
    ├── vite.config.js
    ├── eslint.config.js
    ├── index.html
    └── src/
        ├── main.jsx            # 入口：Clerk / QueryClient / Router / Sentry Provider
        ├── App.jsx             # 路由表
        ├── index.css
        ├── pages/              # 页面组件
        │   ├── HomePage.jsx  ProductDetailPage.jsx  CartPage.jsx
        │   ├── CheckoutReturnPage.jsx                # 支付完成回跳页
        │   ├── OrdersPage.jsx  OrderDetailPage.jsx
        │   ├── OrderChatPage.jsx  OrderVideoPage.jsx  OrderSummaryPage.jsx
        │   ├── AdminProductsPage.jsx  SentryDemoPage.jsx
        ├── components/         # Layout / Navbar / Footer / 商品卡片 / 骨架屏等
        ├── hooks/              # 页面逻辑（数据请求 + 状态），与 pages 一一对应
        ├── lib/
        │   ├── api.js              # 统一 fetch 封装（带 Clerk token + Sentry 上报）
        │   ├── imagekitUpload.js
        │   └── imagekitUrl.js
        ├── store/
        │   └── cart.js             # zustand 购物车（仅存 productId + quantity）
        └── utils/
            └── format.js
```

## 环境要求

- Node.js >= 20（当前开发环境 v22.19.0）
- npm
- 可访问的 PostgreSQL（项目使用 Neon，连接串配置在 `DATABASE_URL`）

## 一、安装依赖

根目录没有 workspace 配置，需分别在两个目录下安装：

```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install
```

## 二、配置环境变量

后端启动时会用 zod 校验环境变量，缺失或不合法会直接抛错退出，必须先完成这步。
在 `backend/` 下创建 `.env`（可参考 `backend/.env.example`）：

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

前端在 `frontend/` 下创建 `.env`：

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
VITE_API_URL=http://localhost:1997
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### 注意事项

- **变量名必须完全一致**。写成 `FRONTED_URL` 会校验失败，报 `{ FRONTEND_URL: [ 'Required' ] }`。
- `POLAR_API_BASE` 不要写成 `POLAR_API_BASE_URL`——后者读取不到，会静默回落到生产地址 `https://api.polar.sh`，导致沙箱 token 请求失败（结算接口 500）。
- `NODE_ENV`、`PORT`、`POLAR_API_BASE` 有默认值，可不填。
- **前端 `VITE_*` 在构建时内联**，改动后必须重启 `npm run dev` 才会生效。
- `.env` 含明文密钥，**不要提交到仓库**（已在 `.gitignore` 中）。

## 三、启动开发环境

需要两个终端：

```bash
# 终端 1：后端
cd backend
npm run dev
```

看到 `Listening on port: 1997`（或你配置的端口）即成功，`tsx watch` 会在文件改动时自动重启。

```bash
# 终端 2：前端
cd frontend
npm run dev
```

看到 `Local: http://localhost:5173/` 即成功，浏览器访问 http://localhost:5173。

## 四、生产构建与部署

```bash
# 后端：TypeScript 编译到 dist/
cd backend
npm run build
npm start          # 运行编译产物

# 前端：构建静态资源到 dist/
cd frontend
npm run build
npm run preview    # 本地预览构建产物
```

Docker（**必须在仓库根目录执行**，构建上下文包含 frontend 与 backend）：

```bash
docker build -t northwind .
docker run -p 3000:3000 --env-file backend/.env northwind
```

容器镜像中前端产物会被复制到 `public/`，由 Express 托管并提供 SPA 兜底路由；后端已包含 `/health` 健康检查端点。

## 五、支付链路与 Webhook

订单**不是**下单时创建的，完整链路为：

1. `POST /api/checkout` → 按服务端商品现价计算金额 → 写入 `checkout_sessions` → 调 Polar 创建结算会话 → 返回 `checkoutUrl`
2. 前端整页跳转到 Polar 收银台 → 用户支付
3. Polar 推送 `order.paid` 到 `POST /webhooks/polar` → 验签 → 事务内创建 `orders` + `order_items` 并删除 `checkout_sessions`
4. 前端跳回 `/checkout/return?checkout_id=...`

**本地开发时 Polar 无法访问 `localhost`**，webhook 收不到，订单不会生成。需要内网穿透：

```bash
polar listen localhost 1997          # 官方 CLI
# 或 cloudflared tunnel --url http://localhost:1997
```

然后把公网地址填入 Polar 后台 → Settings → Webhooks，端点为 `https://<你的地址>/webhooks/polar`，事件勾选 `order.paid`。

部署平台（如 Render）上要**在环境变量面板单独配置** `POLAR_WEBHOOK_SECRET`、`POLAR_API_BASE` 等，仓库里的 `.env` 不会同步过去。

## 六、常用命令

```bash
cd backend
npm run dev        # tsx watch，开发热重载
npm run build      # tsc 编译
npm start          # 运行编译产物

cd frontend
npm run lint       # ESLint 检查
```

## 常见问题

**启动报 `Invalid environment variables`**

查看控制台打印的字段错误列表（如 `{ FRONTEND_URL: [ 'Required' ] }`），对照 `backend/src/lib/env.ts` 补齐或修正变量名与格式（`FRONTEND_URL`、`IMAGEKIT_URL_ENDPOINT`、`SENTRY_DSN`、`POLAR_API_BASE` 需为合法 URL）。

**前端请求报 `ERR_CONNECTION_REFUSED`**

后端没在运行。确认端口一致：`backend/.env` 的 `PORT` 与 `frontend/.env` 的 `VITE_API_URL`（改前端 `.env` 后需重启 Vite）。

**结算接口 500**

多为 Polar 配置问题：确认 `POLAR_API_BASE` 变量名正确、access token 属于沙箱组织、`POLAR_CHECKOUT_PRODUCT_ID` 是沙箱后台复制的商品 ID。后端终端会打印 `[checkout] 创建结算会话失败:` 及 Polar 返回的原始错误。

**支付成功但 `orders` 表为空**

说明 `order.paid` webhook 没送达或验签失败。到 Polar 后台查看投递记录：连接失败=需要内网穿透；返回 400=验签失败（密钥不要用额外编码，`standardwebhooks` 原生支持 `whsec_` 前缀）；修好后点 **Redeliver** 重放即可补履约。

**端口被占用**

修改 `backend/.env` 的 `PORT`，或前端启动时 `npm run dev -- --port 5174`。

**跨域**

后端已启用 `cors()` 默认允许所有来源；若前端端口变更，同步更新 `backend/.env` 的 `FRONTEND_URL`。
