// getAuth 读取 clerkMiddleware() 挂载到请求上的认证信息
import { getAuth } from "@clerk/express"
import { Router } from "express";
// 用 Clerk 的 userId 换取本库 users 表的记录（含 role 等业务字段）
import { getLocalUser } from "../lib/users.js";

const router = Router();

// GET /api/me：返回当前登录用户的档案
router.get("/", async (req, res, next) => {
    try {
        // userId 即 Clerk 侧的 clerkUserId，与 users.clerkUserId 对应
        const { userId, isAuthenticated } = getAuth(req);

        // 双重判断：isAuthenticated 保证会话有效，userId 保证类型收窄为 string
        if (!isAuthenticated || !userId) {
            res.status(401).json({ error: "未认证" })
            return;
        }

        const user = await getLocalUser(userId);
        res.json({ user })
    } catch (err) {
        // 交给 Express 错误处理中间件统一处理，避免异步异常导致请求挂起
        next(err)
    }
})

export default router;