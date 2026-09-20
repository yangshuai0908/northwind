// 副作用导入：必须在读取 process.env 之前执行，用于加载 .env
import "dotenv/config";
import express from "express";
import cors from "cors";

// 用于判断 public 目录是否存在，并提供静态托管
import fs from "node:fs";
import path from "node:path";

import { clerkMiddleware } from "@clerk/express";
import { clerkWebhookHandler } from "./webhooks/clerk";
import { getEnv } from "./lib/env";
import keepAliveCron from "./lib/cron";

// 读取并校验环境变量；缺失或不合法会在此处直接抛错退出，避免带着错误配置运行
const env = getEnv();
const app = express();

// Clerk webhook 需要用原始 body 做签名校验，因此不能用 express.json()
const rawJson = express.raw({ type: "application/json", limit: "1mb" });

// 不要解析webhook事件数据，这一点很重要，它应该是原始格式
// 该路由必须注册在任何 JSON 解析中间件之前
app.post("/webhooks/clerk", rawJson, (req, res) => {
  void clerkWebhookHandler(req, res);
});


app.use(express.json());
app.use(cors())
// 把 Clerk 的认证信息挂载到 req.auth，供后续路由/中间件读取
app.use(clerkMiddleware());


app.get("/health", (_req, res) => {
  res.json({ ok: true });
});


// 托管前端构建产物（Docker 镜像中由 Vite 构建阶段复制到 ./public）
// 本地开发时不存在该目录，因此需要先判断，避免 express.static 报路径错误
const publicDir = path.join(process.cwd(), "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));

  // SPA 兜底路由：非静态资源的路径都返回 index.html，交给前端路由处理
  app.get("/{*any}", (req, res, next) => {
    // 只处理 GET/HEAD，其余方法交由后续路由或 404
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    // API 与 webhook 路径不属于前端路由，直接跳过兜底，交给对应路由处理
    if (req.path.startsWith("/api") || req.path.startsWith("/webhooks")) {
      next();
      return;
    }

    // 发送 index.html；出错时交给 Express 错误处理链
    res.sendFile(path.join(publicDir, "index.html"), (err) => next(err))
  });
}

app.listen(env.PORT, () => {
  console.log("Listening on port: ", env.PORT);
  // 启动定时任务，定期向前端健康检查端点发送请求，避免前端容器被云平台休眠
  if (env.NODE_ENV === "production") {
    keepAliveCron.start();
  }
});