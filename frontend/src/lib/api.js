import * as Sentry from "@sentry/react";

// 后端接口地址。未配置时 base 为空字符串，即同源部署（前后端共用一个域名）
const raw = import.meta.env.VITE_API_URL;
const base = typeof raw === "string" ? raw.replace(/\/+$/, "") : ""; // 去掉后面的斜杠

// 这是一个经过身份验证的fetch请求，我们使用它向API发送请求
/**
 * 统一的接口请求封装：拼接 base、附带 Clerk token、上报 Sentry、错误转成 Error 抛出。
 *
 * 注意：这里不用 axios，直接用 fetch；调用方需自行传入 Clerk 的 getToken，
 * 以便每个组件自行决定是否需要认证（公开商品列表就不需要 token）。
 */
export async function apiFetch(path, opts = {}) {
    const { getToken, method = "GET", body } = opts;
    const headers = { "Content-Type": "application/json" };

    // 只有传入 getToken 才做认证；token 为 null（未登录）时静默跳过，由后端返回 401
    if (getToken) {
        // 每次请求都实时取 token，避免用到过期会话
        const token = await getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    }
    let res;
    try {
        // 只捕获「网络层」异常（断网、DNS、CORS 被拒等），HTTP 4xx/5xx 不会进这里
        res = await fetch(`${base}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined, // undefined 时 fetch 不带 body，符合 GET 语义
        });
    } catch (e) {
        // breadcrumb 记录出错前发生了什么，captureException 才真正上报一条 issue
        Sentry.addBreadcrumb({
            category: "api",
            message: `${method} ${path}`,
            level: "error",
            data: { network: true },
        });
        Sentry.captureException(e, {
            tags: { "api.fetch": "network" },
            extra: { path, method },
        });

        throw e; // 原样抛出，交给调用方（react-query）处理重试与错误展示
    }

    // 后端所有接口都返回 JSON；若返回空 body 或非 JSON 会在此抛错
    const data = await res.json();

    // 无论成功失败都留痕，出错时能还原调用序列
    Sentry.addBreadcrumb({
        category: "api",
        message: `${method} ${path}`,
        level: res.ok ? "info" : "warning",
        data: { status: res.status },
    });

    if (!res.ok) {
        // 优先用后端返回的 { error } 文案，其次用 HTTP 状态文案
        const msg = typeof data?.error === "string" ? data.error : res.statusText;
        const err = new Error(typeof msg === "string" ? msg : "Request failed");

        // 只上报 5xx：4xx 是客户端预期内的错误（未登录、校验失败等），上报会造成噪音
        if (res.status >= 500) {
            Sentry.captureException(err, {
                tags: { "api.fetch": "http", "http.status": String(res.status) },
                extra: { path, method, status: res.status },
            });
        }

        throw err;
    }

    return data;
}