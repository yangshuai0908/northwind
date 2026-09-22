import type { Request, Response } from "express";
import { getEnv } from "../lib/env.js";
import { checkoutSessions, orderItems, orders } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { Webhook } from "standardwebhooks"; // Standard Webhooks 规范（Polar/Svix 采用）的签名校验实现

/**
 * 读取请求头并归一成字符串。
 * 同一个头可能出现多次（值为数组），签名校验只接受单值，因此取第一个。
 */
function headerString(headers: Request["headers"], name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 从 Polar 事件数据的 metadata 中取出创建结算时我们自己写入的 checkout_session_id。
 * 数据是外部输入，逐层做类型守卫，取不到就返回 undefined 由调用方降级处理。
 */
function checkoutSessionIdFromMetadata(order: Record<string, unknown>) {
  const metadata = order.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const sessionId = (metadata as Record<string, unknown>).checkout_session_id;
  return typeof sessionId === "string" ? sessionId : undefined;
}

/**
 * 幂等检查：该笔支付是否已生成过已支付订单。
 * Polar 可能重复推送同一事件，分别用 Polar 订单号与 checkout id 两种线索各查一次。
 */
async function alreadyPaid(polarOrderId?: string, checkoutId?: string) {
  if (polarOrderId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarOrderId, polarOrderId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  if (checkoutId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarCheckoutId, checkoutId))
      .limit(1);
    if (row?.status === "paid") return true;
  }
  return false;
}

/**
 * 履约：把结算会话转为正式订单。
 *
 * 全流程放在一个事务里：建订单 → 写明细 → 删除会话，要么全部成功要么全部回滚，
 * 避免出现「有订单无明细」或「重复履约」的中间状态。
 */
async function fulfillCheckoutSession(
  sessionId: string,
  polarOrderId: string | undefined,
  checkoutId: string | undefined,
) {
  return await db.transaction(async (tx) => {
    // FOR UPDATE：对会话行加行锁。并发的重复回调会在此排队，
    // 先到者删除该行，后者查不到即返回 false，从而避免重复生成订单
    const [session] = await tx
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId))
      .for("update");

    // 会话不存在 = 已履约过或从未创建，返回 false 由上层判定
    if (!session) return false;

    const [order] = await tx
      .insert(orders)
      .values({
        userId: session.userId,
        status: "paid", // 走到这里说明 Polar 已确认收款
        totalCents: session.totalCents, // 沿用落库时算好的金额，不重新计算
        // 优先用事件里的 checkout id，其次用会话已回填的，都没有则留空
        polarCheckoutId: checkoutId ?? session.polarCheckoutId ?? null,
        // Polar 订单号可能缺失，用条件展开避免写入 undefined 覆盖默认值
        ...(polarOrderId ? { polarOrderId } : {}),
      })
      .returning(); // 需要订单 id 才能插入明细

    // 明细来自会话里的金额快照，因此不受后续商品调价影响
    if (session.lines.length) {
      await tx.insert(orderItems).values(
        session.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      );
    }

    // 删除会话：既是清理，也是「已处理」的标记（配合上面的行锁实现幂等）
    await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));

    return true;
  });
}

/**
 * Polar Webhook 入口
 * POST /webhooks/polar（需由 express.raw() 提供未被解析的原始 body，验签依赖原始字节）
 *
 * 只处理 order.paid 事件，其余事件一律快速返回 200，避免 Polar 因非 2xx 反复重试。
 */
export async function polarWebhookHandler(req: Request, res: Response) {
  const env = getEnv();

  try {
    if (!env.POLAR_WEBHOOK_SECRET) {
      res.status(503).send("Polar webhooks not configured");
      return;
    }

    // 签名必须基于原始字节：已解析成对象的 body 重新序列化后可能与原文不一致，导致验签失败
    const raw = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body));

    // Standard Webhooks 的密钥：库本身支持 whsec_ 前缀并自动解析，
    // 不要再做额外的编码转换（双重编码会导致验签必然失败）
    const wh = new Webhook(env.POLAR_WEBHOOK_SECRET);

    const id = headerString(req.headers, "webhook-id");
    const ts = headerString(req.headers, "webhook-timestamp"); // 时间戳参与签名，可防重放
    const sig = headerString(req.headers, "webhook-signature");

    if (!id || !ts || !sig) {
      res.status(400).json({ error: "Missing webhook headers" });
      return;
    }

    // 验签失败会抛错，由下方 catch 统一返回 400；这一步之后才可信任请求内容
    wh.verify(raw, { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig });

    const event = JSON.parse(raw.toString("utf8")) as {
      type: string;
      data?: Record<string, unknown>;
    };

    if (event.type === "order.paid" && event.data) {
      const data = event.data;
      const polarOrderId = typeof data.id === "string" ? data.id : undefined;
      const checkoutId = typeof data.checkout_id === "string" ? data.checkout_id : undefined;

      // 第一道幂等闸门：重复推送直接确认，不做任何写入
      if (await alreadyPaid(polarOrderId, checkoutId)) {
        res.json({ ok: true, duplicate: true });
        return;
      }

      // 反查本地结算会话（创建结算时写进 metadata）
      const sessionId = checkoutSessionIdFromMetadata(data);

      if (sessionId) {
        const ok = await fulfillCheckoutSession(sessionId, polarOrderId, checkoutId);

        if (ok) {
          res.json({ ok: true });
          return;
        }

        // 履约返回 false 可能是并发下已被另一路请求处理完，再查一次确认；
        // 确认已支付就返回成功，让 Polar 停止重试
        if (await alreadyPaid(polarOrderId, checkoutId)) {
          res.json({ ok: true, duplicate: true });
          return;
        }

        // 确实无会话可履约：记录日志并返回 500，让 Polar 稍后重试以便人工介入
        console.error("Polar order.paid: could not fulfill checkout session", {
          sessionId,
          checkoutId,
        });

        res.status(500).json({ error: "Checkout fulfillment failed" });
        return;
      }
    }

    // 其他事件类型或未携带 metadata：返回 200 表示已接收，避免无意义的重试
    res.json({ ok: true });
  } catch (err) {
    console.error("Polar webhook error", err);
    res.status(400).json({ error: "Invalid webhook" });
  }
}