// useSearchParams：把筛选条件同步到 URL query，刷新/分享链接都能保持当前分类
import { useSearchParams } from "react-router";
import { apiFetch } from "../lib/api.js";
import { useQuery } from "@tanstack/react-query";

/**
 * 首页商品目录：分类筛选 + 商品列表。
 *
 * 把「当前分类」放在 URL（?category=xxx）而不是组件 state，好处是：
 * 刷新页面、前进后退、把链接发给别人，都能还原同样的筛选结果。
 */
export function useHomeCatalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  // 未带 category 参数时返回空串，表示「全部」；trim 掉用户手输的空格
  const categoryFilter = searchParams.get("category")?.trim() ?? "";

  // 切换分类。传空值表示清除筛选
  const setCategory = (category) => {
    // 基于当前参数复制一份，避免覆盖掉 URL 上其他参数（如分页、搜索词）
    const next = new URLSearchParams(searchParams);

    if (!category) next.delete("category"); // 空值直接删掉参数，URL 更干净
    else next.set("category", category);

    // replace: true —— 不往历史栈里堆记录，浏览器返回键不会在分类之间来回跳
    setSearchParams(next, { replace: true });
  };

  // 分类列表：与当前筛选无关，故 queryKey 固定，全站只请求一次并被缓存复用
  const { data: categoriesData, isLoading: loadingCategories } = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => apiFetch("/api/products/categories"),
  });

  // 商品列表：categoryFilter 进 queryKey，分类变化时自动重新请求，
  // 且每个分类的结果各自缓存，来回切换能秒出（staleTime 内不重复请求）
  const {
    data: productsData,
    isLoading: loadingList,
    error,
  } = useQuery({
    queryKey: ["products", categoryFilter],
    queryFn: () =>
      apiFetch(
        // 中文/空格等必须编码，否则会拼出非法 URL
        categoryFilter
          ? `/api/products?category=${encodeURIComponent(categoryFilter)}`
          : "/api/products",
      ),
  });

  // 后端返回 { categories: [...] } / { products: [...] }，取不到时降级为空数组，避免渲染时报错
  const categories = categoriesData?.categories ?? [];
  const products = productsData?.products ?? [];
  // 只在「首次加载且还没有数据」时显示骨架屏；
  // 已有数据时的后台刷新不再闪 loading，避免分类切换时整块内容抖动
  const categoryChipsLoading = loadingCategories && categories.length === 0;

  return {
    categoryFilter,
    setCategory,
    categories,
    products,
    categoryChipsLoading,
    loadingCategories,
    loadingList,
    error,
  };
}