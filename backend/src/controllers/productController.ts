// 用 type 导入：这些只是类型，编译后不会留下 require/import，减少无用产物
import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { products } from "../db/schema";
import { and, desc, eq } from "drizzle-orm"; // and 组合条件，desc 倒序，eq 相等匹配

/**
 * 商品列表
 * GET /api/products?category=xxx
 * 只返回上架商品（active = true）；category 为空则返回全部上架商品。
 */
export async function listProducts(req: Request, res: Response, next: NextFunction) {
  try {
    // req.query 的值可能是 string | string[]，这里只接受字符串形式并去空格
    const cat = typeof req.query.category === "string" ? req.query.category.trim() : "";

    // 先构造公共条件，再按需用 and() 叠加分类条件，避免写成 undefined
    const activeOnly = eq(products.active, true);
    const whereClause = cat ? and(activeOnly, eq(products.category, cat)) : activeOnly;

    const rows = await db
      .select()
      .from(products)
      .where(whereClause)
      .orderBy(desc(products.createdAt)); // 最新创建的排在最前

    res.json({ products: rows });
  } catch (e) {
    next(e); // 统一交给错误处理中间件
  }
}

/**
 * 分类列表
 * GET /api/products/categories
 * 从商品表反推出现有分类，因此下架商品的分类不会出现在结果中。
 */
export async function getCategories(_req: Request, res: Response, next: NextFunction) {
  try {
    // 只取 category 列，不拉取整行，减少传输量
    const rows = await db
      .select({ category: products.category })
      .from(products)
      .where(eq(products.active, true));

    // 一个分类对应多个商品，用 Set 去重，再按字母排序保证顺序稳定
    const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => a.localeCompare(b));

    res.json({ categories });
  } catch (e) {
    next(e);
  }
}

/**
 * 商品详情
 * GET /api/products/:slug
 * 用 slug 而非 id 查询，便于对外暴露可读的 URL。
 */
export async function getProductBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    // 解构取首行：查不到时 row 为 undefined
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.slug, req.params.slug as string))
      .limit(1);

    // 不存在或已下架都返回 404，不泄露下架商品信息
    if (!row || !row.active) return res.status(404).json({ error: "Not found" });

    res.json({ product: row });
  } catch (e) {
    next(e);
  }
}