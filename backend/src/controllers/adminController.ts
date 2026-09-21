import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { getLocalUser } from "../lib/users";
import { isAdmin } from "../lib/roles";
import ImageKit from "@imagekit/nodejs";
import { getEnv } from "../lib/env";
import { db } from "../db";
import { orderItems, products } from "../db/schema";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { deleteImageKitAsset } from "../lib/imagekit"; // 删除商品时同步清理 ImageKit 上的图片

const env = getEnv();

// 新建商品的入参校验。金额用正整数「分」，从源头杜绝小数与负值
const productCreate = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1).default("General"),
  description: z.string().default(""),
  priceCents: z.number().int().positive(),
  currency: z.string().min(1).default("usd"),
  // 图片字段允许三种形态：合法 URL / 空串（表示清除）/ 不传或 null
  imageUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
  imageKitFileId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  active: z.boolean().default(true),
});

// 更新复用同一套规则，但全部字段变为可选（PATCH 语义：只改传了的部分）
const productPatch = productCreate.partial();

/**
 * 把校验后的请求体转成 UPDATE 的 set 对象。
 *
 * 逐字段用 !== undefined 判断，而不是直接展开 body：
 * 这样未传的字段不会出现在 set 中，从而不会被写空覆盖；
 * 传了空串的图片字段则显式转成 null，表示「清除图片」。
 */
function buildProductUpdateSet(body: z.infer<typeof productPatch>) {
  const data: Partial<typeof products.$inferInsert> = {};
  if (body.slug !== undefined) data.slug = body.slug;
  if (body.name !== undefined) data.name = body.name;
  if (body.category !== undefined) data.category = body.category;
  if (body.description !== undefined) data.description = body.description;
  if (body.priceCents !== undefined) data.priceCents = body.priceCents;
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl === "" ? null : body.imageUrl;
  if (body.imageKitFileId !== undefined) {
    data.imageKitFileId = body.imageKitFileId === "" ? null : body.imageKitFileId;
  }
  if (body.active !== undefined) data.active = body.active;
  return data;
}

/**
 * 管理员权限中间件：挂在管理类路由之前。
 * 认证失败返回 401，已登录但非管理员返回 403——两者语义不同，便于前端区分处理。
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const user = await getLocalUser(userId);

    // 角色取自本地库，不依赖 Clerk，避免前端可篡改的 token 声明影响鉴权
    if (!isAdmin(user.role)) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * 下发 ImageKit 上传凭证（签名 + 过期时间 + token），供前端直传图片。
 * 私钥只用于本地生成签名，不外发；这样图片不经过后端，减少带宽与延迟。
 */
export function getImageKitAuth(_req: Request, res: Response, next: NextFunction) {
  try {
    const client = new ImageKit({ privateKey: env.IMAGEKIT_PRIVATE_KEY });

    // SDK 生成的临时认证参数，有效期较短，可安全交给浏览器
    const auth = client.helper.getAuthenticationParameters();

    res.json({
      ...auth,
      publicKey: env.IMAGEKIT_PUBLIC_KEY, // 公钥，前端初始化 SDK 需要
      urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * 管理端商品列表。
 * 与前台 listProducts 的区别：不过滤 active，管理员需要看到已下架商品。
 */
export async function listAdminProducts(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await db.select().from(products).orderBy(desc(products.createdAt));
    res.json({ products: rows });
  } catch (e) {
    next(e);
  }
}

/** 新建商品 */
export async function createAdminProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = productCreate.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    // 拆出图片字段单独归一化，其余字段原样写入
    const { imageUrl, imageKitFileId, ...rest } = parsed.data;

    const [row] = await db
      .insert(products)
      .values({
        ...rest,
        // 空串/null/undefined 统一存为 null，避免库里出现无意义的空字符串
        imageUrl: imageUrl || null,
        imageKitFileId: imageKitFileId || null,
      })
      .returning(); // 返回完整行，便于前端直接拿到生成的 id 与时间戳

    res.status(201).json({ product: row }); // 创建成功用 201
  } catch (e) {
    next(e);
  }
}

/** 局部更新商品（PATCH 语义） */
export async function updateAdminProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = productPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    const data = buildProductUpdateSet(parsed.data);

    // 全部字段都未提供时直接拒绝，避免执行一次无意义的空 UPDATE
    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [row] = await db
      .update(products)
      .set(data)
      .where(eq(products.id, req.params.id as string))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({ product: row });
  } catch (e) {
    next(e);
  }
}

/**
 * 删除商品。
 * 已被下单的商品不允许删除（order_items.productId 是 restrict 外键），
 * 这里提前用 COUNT 给出友好的 409 提示，改为建议下架（active = false）。
 */
export async function deleteAdminProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;

    // 先查一次：既确认存在，也要拿到 imageKitFileId 用于后续清理图片
    const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // 统计该商品出现在多少个订单明细中
    const [countRow] = await db
      .select({ c: count() })
      .from(orderItems)
      .where(eq(orderItems.productId, id));

    // count() 返回的是字符串（PG bigint），用 Number 转换后再比较
    if (Number(countRow?.c ?? 0) > 0) {
      res.status(409).json({
        error:
          "This product is on one or more orders and cannot be deleted. Deactivate it instead.",
      });
      return;
    }

    // 先删远端图片再删库记录：顺序反过来会丢失 fileId，导致图片成为孤儿文件
    // （图片删除失败不影响商品删除，失败由 deleteImageKitAsset 内部处理）
    await deleteImageKitAsset(env, existing.imageKitFileId);
    await db.delete(products).where(eq(products.id, id));

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}