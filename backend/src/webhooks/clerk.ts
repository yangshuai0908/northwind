import type { Request, Response } from "express";
import { getEnv } from "../lib/env";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { parseRole } from "../lib/roles";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";


export async function clerkWebhookHandler(req: Request, res: Response) {
    const env = getEnv();

    try {
        // Webhook验证需要共享密钥；没有它，我们无法信任传入的邮件.
        if (!env.CLERK_WEBHOOK_SECRET) {
            res.status(503).send("未提供Webhooks secret");
            return;
        }
        // Clerk的验证器期望一个带有原始主体的Web请求；Express可以给出Buffer或string。
        const payload = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body);

        const request = new Request("http://internal/webhooks/clerk", {
            method: "POST",
            headers: new Headers(req.headers as HeadersInit),
            body: payload,
        });
        // 如果签名错误或主体被篡改则抛出；只有这样，我们才会相信一切。
        const evt = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SECRET });

        if (evt.type === "user.created" || evt.type === "user.updated") {
            const u = evt.data;

            const email =
                u.email_addresses?.find((e) => e.id === u.primary_email_address_id)?.email_address ??
                u.email_addresses?.[0]?.email_address;

            const displayName =
                [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || null;

            const role = parseRole(u.public_metadata?.role);

            await db
                .insert(users)
                .values({
                    clerkUserId: u.id,
                    email,
                    displayName,
                    role,
                })
                .onConflictDoUpdate({
                    target: users.clerkUserId,
                    set: { email, displayName, role, updatedAt: new Date() },
                });
        }

        if (evt.type === "user.deleted") {
            const id = evt.data.id;
            if (id) {
                await db.delete(users).where(eq(users.clerkUserId, id));
            }
        }

        res.json({ ok: true });
    } catch (err) {
        // 错误的签名、错误的有效负载或DB错误—不要向客户端泄露详细信息。
        console.error("店员网钩错误", err);
        res.status(400).json({ error: "无效的webhook" });
    }

}