// 需在读取 process.env.DATABASE_URL 之前执行：自动加载 .env 到环境变量
import "dotenv/config";

// Drizzle 的 node-postgres 驱动适配器
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

// 以命名空间整体导入，便于把全部表/关系定义一次性交给 Drizzle 用作查询上下文
import * as schema from "./schema";

// 连接池：复用底层 TCP/认证开销，避免每个请求新建连接；Drizzle 执行查询时按需取连接
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// 全应用共享的数据库实例。
// 传入 schema 后才能使用关联查询：db.query.orders.findMany({ with: { items: true } })
export const db = drizzle(pool, { schema });