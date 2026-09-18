import {
    pgTable, // 定义数据表
    text, // PG text 列
    integer, // PG integer 列
    timestamp, // PG timestamp / timestamptz 列
    uuid, // PG uuid 列
    boolean, // PG boolean 列
    jsonb, // PG jsonb 列，用于存储半结构化数据
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm"; // 声明表之间的逻辑关系（用于关联查询）

/** 订单状态：待支付 / 已支付 / 支付失败 */
export type OrderStatus = "pending" | "paid" | "failed";

/** 用户角色：普通客户 / 客服 / 管理员（决定接口访问权限） */
export type UserRole = "customer" | "support" | "admin";

/** 结算会话中的单行商品快照 */
export type CheckoutSessionLine = {
    productId: string; // 商品 ID
    quantity: number; // 购买数量
    unitPriceCents: number; // 下单时的单价快照，单位：分
}

/**
 * users 表
 *
 * 应用侧的用户档案表，与 Clerk（外部身份认证服务）通过 clerkUserId 关联：
 * 认证与凭证由 Clerk 托管，本表只保存业务所需的资料、角色与时间戳。
 * 内部表之间的关联（如 orders.userId）使用本表的 id，而非 clerkUserId，
 * 以便在外部身份发生变化时无需迁移业务数据。
 */
export const users = pgTable("users", {
    // 内部主键，由数据库默认生成 uuid v4
    id: uuid("id").defaultRandom().primaryKey(),

    // Clerk 侧的用户 ID，全局唯一，作为内外用户的关联锚点
    clerkUserId: text("clerk_user_id").notNull().unique(),

    email: text("email").notNull().unique(),

    // 昵称，非必填
    displayName: text("display_name"),

    // 角色：customer | support | admin
    // 数据库层是普通 text，取值约束由 TypeScript 的 UserRole 联合类型保证
    role: text("role").$type<UserRole>().notNull().default("customer"),

    // 带时区的创建/更新时间，默认取数据库当前时间
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})


/**
 * products 表
 *
 * 商品主表。金额统一以「最小货币单位」的整数存储（priceCents，单位：分），
 * 避免浮点数精度误差；货币符号/展示格式交由前端按 currency 处理。
 * 图片托管在 ImageKit，因此同时保存访问 URL 与用于删除操作的 fileId。
 */
export const products = pgTable("products", {
  // 内部主键，由数据库默认生成 uuid v4
  id: uuid("id").defaultRandom().primaryKey(),

  // URL 友好且唯一的短标识，用于对外暴露商品详情路由
  slug: text("slug").notNull().unique(),

  name: text("name").notNull(),

  // 商品分类，默认归入 General
  category: text("category").notNull().default("General"),

  description: text("description").notNull().default(""),

  // 售价，单位：分。整数存储，不使用浮点
  priceCents: integer("price_cents").notNull(),

  // 货币代码（小写 ISO 4217，如 usd），默认 usd
  currency: text("currency").notNull().default("usd"),

  // ImageKit 的图片访问 URL，商品可暂无图片
  imageUrl: text("image_url"),

  /** ImageKit `fileId` for deletes */
  // 删除或更换图片时需要 fileId 才能调用 ImageKit 删除 API
  imageKitFileId: text("image_kit_file_id"),

  // 是否上架。软删除/下架开关，历史订单仍可引用该商品
  active: boolean("active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * checkout_sessions 表
 *
 * 一次结算流程的中间态：在跳转第三方支付（Polar）之前落库，
 * 保存下单那一刻的商品明细与金额快照。支付完成后由 webhook 依据
 * polarCheckoutId 回查本记录，再生成正式的 order。
 * 用 jsonb 而非关联表存储明细，是因为这是「下单瞬间的快照」，
 * 后续商品价格变动不应影响本次结算。
 */
export const checkoutSessions = pgTable("checkout_sessions", {
  // 内部主键，由数据库默认生成 uuid v4
  id: uuid("id").defaultRandom().primaryKey(),

  // 所属用户。用户被删除时级联清理其结算会话
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // Polar 侧的 checkout 会话 ID，webhook 回调时用于反查（创建前可能为空）
  polarCheckoutId: text("polar_checkout_id").unique(),

  // 下单快照：商品 ID、数量、单价（分）；DB 层是 jsonb，成员类型由 TS 保证
  lines: jsonb("lines").$type<CheckoutSessionLine[]>().notNull(),

  // 快照总金额，单位：分。冗余存储，避免每次遍历 lines 重算
  totalCents: integer("total_cents").notNull(),

  // 货币代码（小写 ISO 4217，如 usd）
  currency: text("currency").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});


/**
 * orders 表
 *
 * 正式订单，支付成功后由 Polar webhook 创建/更新（依据 polarCheckoutId 定位结算会话）。
 * 订单金额同样以「分」为单位冗余存储，不依赖 checkout_sessions 或商品现价重新计算。
 * 注意：用户删除时会级联删除其订单，如需保留账目请改为软删除方案。
 */
export const orders = pgTable("orders", {
  // 内部主键，由数据库默认生成 uuid v4
  id: uuid("id").defaultRandom().primaryKey(),

  // 下单用户。用户被删除时级联清理其订单
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // 订单状态：pending | paid | failed，默认 pending，由支付回调推进
  status: text("status").$type<OrderStatus>().notNull().default("pending"),

  // 关联的 Polar checkout 会话 ID（非唯一：同一会话理论上只应生成一张订单）
  polarCheckoutId: text("polar_checkout_id"),

  // Polar 侧订单 ID，唯一，用于对账与幂等处理重复回调
  polarOrderId: text("polar_order_id").unique(),

  // 订单总金额，单位：分
  totalCents: integer("total_cents").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * order_items 表
 *
 * 订单明细行。这里使用规范化的关联表（而非 jsonb），因为订单是已完成的正式账目，
 * 需要通过 productId 反查真实商品；而 checkout_sessions.lines 只是下单快照。
 * unitPriceCents 保存成交当时的单价，后续商品调价不影响历史订单。
 */
export const orderItems = pgTable("order_items", {
  // 内部主键，由数据库默认生成 uuid v4
  id: uuid("id").defaultRandom().primaryKey(),

  // 所属订单。订单删除时级联清理明细
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),

  // 商品引用。restrict：只要还有订单引用该商品，就不允许删除商品，保护历史账目
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),

  quantity: integer("quantity").notNull(),

  // 成交单价快照，单位：分
  unitPriceCents: integer("unit_price_cents").notNull(),
});

// cascade = “delete children when parent is deleted”; restrict = “don’t delete the parent if any child still points at it.”

// 一个用户在一段时间内可以有很多订单.
/**
 * 用户 → 订单：一对多。
 *
 * 注意：relations() 只声明查询层面的逻辑关系（供 db.query.users.findMany({ with: { orders: true } }) 使用），
 * 不会生成任何外键或 SQL；真正的数据库约束来自各表字段上的 .references()。
 */
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
}));

// 同一个商品可能出现在多个订单行中
/**
 * 商品 → 订单明细：一对多。
 *
 * 查询层面可用 db.query.products.findMany({ with: { orderItems: true } }) 拉取销量相关明细。
 * 与 usersRelations 一样，此处仅声明逻辑关系，不产生 SQL 约束；
 * 参照完整性由 order_items.productId 的 .references(..., { onDelete: "restrict" }) 保证。
 */
export const productsRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
}));

// 每个订单属于一个用户；每个订单可以有多个明细行。
export const ordersRelations = relations(orders, ({ one, many }) => ({
  // 多对一：多条订单指向同一个 users 行。
  // fields = 本表的外键列（源），references = 目标表被指向的列。
  // 因为是「多」的一方持有外键，所以只需在此处显式指定；users 侧用 many(orders) 即可自动配对。
  user: one(users, { fields: [orders.userId], references: [users.id] }),

  // 一对多：一个订单包含多个明细行
  items: many(orderItems),
}));

// 每个订单明细行属于一个订单和一个商品
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  // 多对一：多条明细行指向同一张订单
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),

  // 多对一：多条明细行可以指向同一个商品（该商品被多张订单购买过）
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));