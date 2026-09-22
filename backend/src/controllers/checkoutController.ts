import type { Request, Response, NextFunction } from "express";
import { getEnv } from "../lib/env";
import z from "zod";
import { getAuth } from "@clerk/express";
import { getLocalUser } from "../lib/users";
import { db } from "../db";
import { CheckoutSessionLine, checkoutSessions, products } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm"; // inArray：一次查出购物车中的所有商品，避免 N 次查询
import { polarCreateCheckout } from "../lib/polar";

const env = getEnv();

// 购物车入参校验：只接收 productId + quantity，绝不信任客户端传来的价格
const cartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(), // 必须是合法 uuid
        quantity: z.number().int().positive(), // 正整数，拦截 0 与负数
      }),
    )
    .min(1), // 空购物车直接拒绝
});

/**
 * 创建结算会话并返回 Polar 收银台地址
 * POST /api/checkout（路径以实际路由注册为准）
 *
 * 金额一律以服务端数据库中的商品现价计算，客户端只提供商品与数量，防止篡改价格。
 */
export async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    // only signed-in users can start checkout
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // 用 safeParse 而非 parse：自行返回 400，不让 zod 抛错进 next()
    const parsed = cartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid cart", details: parsed.error.flatten() });
      return;
    }

    // polar access token is required
    if (!env.POLAR_ACCESS_TOKEN) {
      res.status(503).json({ error: "付款未配置" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "账户尚未同步" });
      return;
    }

    const ids = parsed.data.items.map((i) => i.productId);

    // 加载所有存在的、活跃的、与我们请求的id匹配的购物车产品.
    const prodRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, ids), eq(products.active, true)));

    // 数量不等说明存在不存在的商品、已下架商品或重复 ID，统一拒绝（不逐个区分以免泄露信息）
    if (prodRows.length !== ids.length) {
      res.status(400).json({ error: "一个或多个商品无效" });
      return;
    }

    // 转成 Map，循环内以 O(1) 取商品；上面的长度校验保证这里必然命中，故用非空断言
    const byId = new Map(prodRows.map((p) => [p.id, p]));
    let totalCents = 0;
    const lines: CheckoutSessionLine[] = [];

    for (const line of parsed.data.items) {
      const p = byId.get(line.productId)!;

      // 单价取数据库现值，数量累加；全程整数「分」，无浮点误差
      totalCents += p.priceCents * line.quantity;

      // 金额快照：即使后续商品调价，本次结算仍按此价格执行
      lines.push({
        productId: p.id,
        quantity: line.quantity,
        unitPriceCents: p.priceCents,
      });
    }

    // Polar 对固定金额有最小金额限制（USD 为 10 分），提前拦截避免调用后失败
    if (totalCents < 10) {
      res.status(400).json({
        error: "总额低于 Polar 最低标准（例如，美元要求至少10美分）",
      });
      return;
    }

    // 先落库生成内部会话，拿到 session.id 才能写入 Polar 元数据
    const [session] = await db
      .insert(checkoutSessions)
      .values({
        userId: localUser.id, // 注意存的是本地 users.id，不是 Clerk ID
        lines,
        totalCents,
        currency: "usd",
      })
      .returning(); // 需显式 returning，才能取回自增/默认的 id

    // {CHECKOUT_ID} 是 Polar 的占位符，支付完成后会被替换为真实 checkout id
    const successUrl = `${env.FRONTEND_URL}/checkout/return?checkout_id={CHECKOUT_ID}`;
    const returnUrl = `${env.FRONTEND_URL}/cart`; // 用户取消支付时回到的页面

    const checkout = await polarCreateCheckout(env, {
      products: [env.POLAR_CHECKOUT_PRODUCT_ID],

      // 把购物车总额作为「自定义价格」挂到该商品上，实现动态金额
      prices: {
        [env.POLAR_CHECKOUT_PRODUCT_ID]: [
          {
            amount_type: "fixed",
            price_currency: "usd",
            price_amount: totalCents,
          },
        ],
      },

      success_url: successUrl,
      return_url: returnUrl,
      external_customer_id: userId, // 便于在 Polar 后台对账到 Clerk 用户
      metadata: { checkout_session_id: session.id }, // webhook 回以此反查本地会话
    });

    // 会话创建成功后回填 Polar 侧的 checkout id，支付成功回调时用它定位订单来源
    await db
      .update(checkoutSessions)
      .set({ polarCheckoutId: checkout.id })
      .where(eq(checkoutSessions.id, session.id));

    res.json({ checkoutUrl: checkout.url });
  } catch (e) {
    // 显式打印：Express 默认错误处理只返回 500，不打印上下文，排查时很难定位
    console.error("[checkout] 创建结算会话失败:", e);
    next(e);
  }
}