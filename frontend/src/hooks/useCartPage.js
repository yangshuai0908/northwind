// useAuth 提供 getToken，结算接口需要它做身份认证
import { useAuth } from "@clerk/react";

// 购物车是 zustand 本地状态（未登录也能加购），只存商品 ID 与数量
import { useCart } from "../store/cart";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { useState } from "react";

/**
 * 购物车页逻辑：把本地购物车条目与服务端商品数据合并，并负责发起结算。
 *
 * 设计要点：购物车只保存 { productId, quantity }，价格、名称、图片一律以服务端当前数据为准，
 * 这样商品改价/下架后购物车展示的永远是最新信息，不会因为本地缓存出现「价格不符」。
 */
export default function useCartPage() {
    const { getToken } = useAuth();
    // 结算按钮的 loading 状态。跳转支付页后不复位（见 checkout 内注释）
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    // 逐个 selector 订阅，只在这个字段变化时才重渲染（zustand 细粒度订阅）
    const items = useCart((s) => s.items);
    const setQty = useCart((s) => s.setQty);
    const removeItem = useCart((s) => s.removeItem);

    // 购物车为空时完全不请求商品列表，省掉一次无用网络往返
    const {
        data,
        isLoading: productsLoading,
        isError: productsError,
    } = useQuery({
        queryKey: ["products"], // 与首页共用缓存，从首页进购物车不会重复请求
        queryFn: () => apiFetch("/api/products"),
        enabled: items.length > 0, // 空车时 query 保持 idle 状态
    });

    const products = data?.products ?? [];
    // 转成 id -> 商品 的映射，避免每个购物车条目都在数组里 find 一次
    const byId = new Map(products.map((p) => [p.id, p]));
    // 合并后的行；product 为 null 表示商品已下架/删除或尚未加载完
    const lines = items.map((line) => ({
        line,
        product: byId.get(line.productId) ?? null,
    }));

    // 小计：按服务端现价计算。跳过取不到商品的行，避免 undefined 参与运算得出 NaN
    // 单位与后端一致为「分」，展示时再除以 100
    const subtotal = lines.reduce((sum, { line, product: p }) => {
        if (!p) return sum;
        return sum + p.priceCents * line.quantity;
    }, 0);

    async function checkout() {
        setCheckoutLoading(true);

        // 只提交 ID 与数量，金额由后端按商品现价重算，前端传的金额不可信
        const body = {
            items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        };

        // apiFetch 失败时会抛错，由页面/ErrorBoundary 处理；此处不做 try/catch
        const res = await apiFetch("/api/checkout", {
            getToken, // 结算必须登录，否则后端返回 401
            method: "POST",
            body,
        });

        // 拿到第三方（Polar）收银台地址后整页跳转，不能用 SPA 路由跳转
        if (res?.checkoutUrl) {
            // 刻意不 setCheckoutLoading(false)：跳转期间保持 loading，防止用户重复点击
            window.location.href = res.checkoutUrl;
            return;
        }

        setCheckoutLoading(false);
    }

    return {
        items,
        setQty,
        removeItem,
        productsLoading,
        productsError,
        lines,
        subtotal,
        checkout,
        checkoutLoading,
    };
}