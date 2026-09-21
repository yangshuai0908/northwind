// React 18+ 的渲染入口
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Sentry：错误上报、性能追踪、会话回放
import * as Sentry from '@sentry/react'

// react-query：服务端数据缓存与同步
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Clerk：身份认证。必须在最外层，内部组件才能拿到登录状态
import { ClerkProvider } from '@clerk/react'
// BrowserRouter：基于 History API 的前端路由（需服务端配合 SPA 兜底）
import { BrowserRouter } from "react-router";
import { SentryErrorFallback } from "./components/SentryErrorFallback.jsx";
// 登录用户变化时把用户信息同步给 Sentry，便于定位「谁」遇到了错误
import { SentryUserSync } from "./components/SentryUserSync.jsx";

// 全局唯一的 queryClient，被 QueryClientProvider 注入到整个组件树
const queryClient = new QueryClient()

// 后端接口地址。未配置 VITE_API_URL 时视为同源部署（前后端共用一个域名）
const apiBase = import.meta.env.VITE_API_URL ?? "";
// 需要透传 trace 头（sentry-trace / baggage）的目标，用于串联前后端链路；
// 未配 apiBase 时退回当前页面 origin；SSR 场景没有 window，所以要做判断
const tracePropagationTargets =
  apiBase.length > 0 ? [apiBase] : typeof window !== "undefined" ? [window.location.origin] : [];

// 必须在 render 之前初始化，否则首屏的错误与性能数据会丢失
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN, // 上报地址，未配置则不发送（Sentry 会静默降级）
  environment: import.meta.env.MODE, // development / production，用于在后台区分环境
  sendDefaultPii: true, // 附带 IP、浏览器等默认个人信息（生产需结合隐私合规考虑）
  integrations: [
    Sentry.browserTracingIntegration(), // 性能追踪：页面加载、路由跳转、接口请求耗时
    Sentry.replayIntegration({ // 会话回放：重现用户出错前的操作过程
      maskAllText: false, // 不遮盖文本，回放内容是明文
      maskAllInputs: false, // 不遮盖输入框，密码等敏感输入会被录制
      blockAllMedia: false, // 不屏蔽图片/视频资源
    }),
  ],
  tracesSampleRate: 1.0, // 100% 采样性能数据，生产环境建议调低（如 0.1）
  tracePropagationTargets: tracePropagationTargets,
  replaysSessionSampleRate: 1.0, // 100% 录制普通会话
  replaysOnErrorSampleRate: 1.0, // 出错会话 100% 上传回放
  enableLogs: true, // 允许把 console 日志一并上报
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClerkProvider>
      <SentryUserSync />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* ErrorBoundary 兜住 App 内的渲染异常，避免整页白屏；同时自动上报到 Sentry */}
          <Sentry.ErrorBoundary fallback={<SentryErrorFallback />}>
            <App />
          </Sentry.ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
)



// 简单来说，“browserTracingIntegration”可以让Sentry看到如下内容：
// 页面加载时间
// 路由/导航时间
// 缓慢前端相互作用
// 传出获取/ API请求
// 前端到后端的跟踪链接