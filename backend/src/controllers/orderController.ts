import { getAuth } from "@clerk/express";
import type { NextFunction, Response, Request } from "express";
import { getLocalUser } from "../lib/users";
import { isStaff } from "../lib/roles";
import { db } from "../db";
// users 表用于按订单反查下单人的 Clerk ID（发起视频邀请时需要）
import { orderItems, orders, products, users } from "../db/schema";
import { asc, desc, eq, inArray } from "drizzle-orm"; // inArray：一次性拉取多个订单的明细，避免逐单查询
import { getStreamChatServer, streamChatDisplayName, streamUserId } from "../lib/stream";
import { getEnv } from "../lib/env";

const env = getEnv();

/**
 * 订单列表
 * GET /api/orders
 *
 * 客服/管理员可看全部订单，普通客户只能看自己的；
 * 同时为每个订单附带少量商品缩略信息（previewItems），供列表页展示。
 */
export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
      return;
    }

    // 权限分流：staff 查全表，普通用户按 userId 过滤（注意用的是本地 id，不是 Clerk ID）
    const rows = isStaff(localUser.role)
      ? await db.select().from(orders).orderBy(desc(orders.createdAt))
      : await db
          .select()
          .from(orders)
          .where(eq(orders.userId, localUser.id))
          .orderBy(desc(orders.createdAt));

    const orderIds = rows.map((r) => r.id);
    // orderId -> 明细数组，稍后合并回订单；用 Map 避免在订单列表里做嵌套查询
    const previewByOrder = new Map();

    // 无订单时跳过查询，避免 inArray 传入空数组
    if (orderIds.length > 0) {
      const itemRows = await db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          name: products.name,
          slug: products.slug,
          imageUrl: products.imageUrl,
        })
        .from(orderItems)
        // innerJoin：明细行必然有对应商品；asc(id) 让同一订单的明细顺序稳定
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(inArray(orderItems.orderId, orderIds))
        .orderBy(asc(orderItems.id));

      for (const row of itemRows) {
        const list = previewByOrder.get(row.orderId) ?? [];
        list.push({
          name: row.name,
          slug: row.slug,
          imageUrl: row.imageUrl,
          quantity: row.quantity,
        });
        previewByOrder.set(row.orderId, list);
      }
    }

    const ordersPayload = rows.map((o) => ({
      ...o,
      previewItems: previewByOrder.get(o.id) ?? [],
    }));

    res.json({ orders: ordersPayload });
  } catch (e) {
    next(e);
  }
}

/**
 * 订单详情
 * GET /api/orders/:id
 *
 * 越权访问统一返回 404（而非 403），避免泄露「该订单是否存在」。
 */
export async function getOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
      return;
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // 本人订单或 staff 才可见
    const canAccess = order.userId === localUser.id || isStaff(localUser.role);
    if (!canAccess) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // 明细与商品一起查出：product 整体返回，前端可直接拿到现价、图片等信息
    // 注意商品可能已下架，这里不做过滤，历史订单应如实展示
    const items = await db
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        unitPriceCents: orderItems.unitPriceCents, // 成交当时的单价快照
        product: products, // 整行商品
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, order.id));

    res.json({ order, items });
  } catch (e) {
    next(e);
  }
}

/**
 * 开启订单售后会话（Stream Chat 频道）
 * POST /api/orders/:id/chat
 *
 * 频道 ID 固定为 `order-<订单ID>`，保证客服与客户进入的是同一个会话，重复调用天然幂等。
 */
export async function createStreamChannel(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const server = getStreamChatServer(env);

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
      return;
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isOwner = order.userId === localUser.id;
    if (!isOwner && !isStaff(localUser.role)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // 只有已支付订单才提供售后通道，防止未付款订单占用客服资源
    if (order.status !== "paid") {
      res.status(403).json({ error: "Order must be paid to open support chat" });
      return;
    }

    const streamChatUserId = streamUserId(userId);

    // 先确保该用户在 Stream 侧存在（幂等），否则后续建频道会因创建者不存在而失败
    await server.upsertUser({
      id: streamChatUserId,
      name: streamChatDisplayName(localUser.role, localUser.displayName, localUser.email),
    });

    // 频道 ID 与订单绑定，客服端用同一 ID 加入
    const channelId = `order-${order.id}`;
    const channel = server.channel("messaging", channelId, {
      name: `Support · order ${order.id.slice(0, 8)}`, // 标题只展示订单号前 8 位
      created_by_id: streamChatUserId, // 发起者即创建者
    });

    // create() 对已存在的频道是幂等的，不会重复创建
    await channel.create();

    await channel.addMembers([streamChatUserId]);

    res.json({ channelType: "messaging", channelId, streamUserId: streamChatUserId });
  } catch (e) {
    next(e);
  }
}

/**
 * 客服发起视频邀请
 * POST /api/orders/:id/video-invite
 *
 * 仅 staff 可调用：创建（或复用）订单频道，把双方拉进成员列表，
 * 再以系统消息形式发送一个带 custom.video_invite 标记的加入链接。
 */
export async function createVideoInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const server = getStreamChatServer(env);

    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res.status(503).json({ error: "Account not synced yet" });
      return;
    }

    // 与查看订单不同，这里是明确的权限不足，返回 403 便于前端提示
    if (!isStaff(localUser.role)) {
      res.status(403).json({ error: "Only support or admin can send a video invite" });
      return;
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, req.params.id as string))
      .limit(1);

    // 不存在或未支付合并为同一响应，不暴露订单是否存在
    if (!order || order.status !== "paid") {
      res.status(404).json({ error: "Order not found or not paid" });
      return;
    }

    // 订单只存了本地 userId，需要回查 users 拿到 clerkUserId，才能映射成 Stream 用户 ID
    const [owner] = await db.select().from(users).where(eq(users.id, order.userId)).limit(1);

    const customerSid = streamUserId(owner.clerkUserId);
    await server.upsertUser({
      id: customerSid,
      name: owner.displayName ?? owner.email ?? "Customer",
    });

    const staffStreamUserId = streamUserId(userId);
    await server.upsertUser({
      id: staffStreamUserId,
      name: streamChatDisplayName(localUser.role, localUser.displayName, localUser.email),
    });

    // 与 createStreamChannel 使用同一 channelId 规则，保证客服与客户落在同一个会话里
    const channelId = `order-${order.id}`;
    const channel = server.channel("messaging", channelId, {
      name: `Support · order ${order.id.slice(0, 8)}`,
      created_by_id: customerSid, // 频道归属客户，客服只是被加入的成员
    });

    await channel.create();
    await channel.addMembers([customerSid, staffStreamUserId]); // 双方都加入才能收到消息

    // 去掉 FRONTEND_URL 末尾多余的斜杠，避免拼出 //orders/...
    const joinUrl = `${env.FRONTEND_URL.replace(/\/+$/, "")}/orders/${order.id}/call`;

    await channel.sendMessage({
      text: `Video call — tap Join below (same link for everyone): ${joinUrl}`,
      user_id: staffStreamUserId, // 以客服身份发出
      custom: {
        video_invite: true, // 前端据此渲染「加入通话」按钮
        join_url: joinUrl,
      },
    });

    res.json({ ok: true, joinUrl });
  } catch (e) {
    next(e);
  }
}