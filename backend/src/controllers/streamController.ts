import type { Request, Response, NextFunction } from "express";
// clerkClient 用于在服务端主动调用 Clerk API（此处拉取用户资料）
import { getAuth, clerkClient } from "@clerk/express";
import { getLocalUser } from "../lib/users.js";
import { getStreamChatServer, streamChatDisplayName, streamUserId } from "../lib/stream.js";
import { getEnv } from "../lib/env.js";

// 模块加载时即校验环境变量，避免请求进来才发现配置缺失
const env = getEnv();

/**
 * 签发 Stream Chat 访问令牌
 * POST /api/stream/token（路径以实际路由注册为准）
 *
 * 流程：校验登录态 → 确认本地用户已同步 → 拉取 Clerk 资料 →
 * 在 Stream 侧 upsert 用户 → 生成并返回令牌。
 * 令牌必须由服务端签发（需要 STREAM_API_SECRET），客户端不得自行生成。
 */
export async function createStreamToken(req: Request, res: Response, next: NextFunction) {
  try {
    // userId 是 Clerk 侧 ID，同时用作本地库查询键与 Stream 用户 ID 的来源
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "未授权" });
      return;
    }

    const localUser = await getLocalUser(userId);
    // 用户已在 Clerk 登录，但 webhook 尚未把记录写入本地库：
    // 用 503 表示「稍后重试」，区别于 401 的认证失败
    if (!localUser) {
      res.status(503).json({ error: "帐户尚未同步" });
      return;
    }

    const server = getStreamChatServer(env);

    // 从 Clerk 取头像与姓名等资料，避免在 Stream 侧重复维护
    const clerkUser = await clerkClient.users.getUser(userId);

    // 姓名回退链：Clerk 的 名+姓 → null（交给下面的 ?? 继续回退）
    const combined = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

    // 显示名优先级：本地昵称 > Clerk 姓名 > Clerk 用户名 > 邮箱（在 streamChatDisplayName 内兜底）
    const name = streamChatDisplayName(
      localUser.role, // 角色用于给客服/管理员加标识前缀
      localUser.displayName ?? combined ?? clerkUser.username,
      localUser.email,
    );

    // 无头像时传 undefined，让 Stream 不覆盖已有头像
    const image = clerkUser.imageUrl || undefined;

    // 把 Clerk ID 映射成 Stream 侧的合法用户 ID（通常做字符替换/加前缀）
    const sid = streamUserId(userId);

    // upsert：已存在则更新资料，不存在则创建，天然幂等
    await server.upsertUser({ id: sid, name, image });

    const token = server.createToken(sid);

    // apiKey 是公钥，可安全下发；真正的密钥 STREAM_API_SECRET 保留在服务端
    res.json({ token, apiKey: env.STREAM_API_KEY, userId: sid, name });
  } catch (e) {
    next(e);
  }
}