// 副作用导入：必须在读取 process.env 之前执行，用于加载 .env
import "dotenv/config";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dsn = process.env.SENTRY_DSN;

// 节点分析集成是为了在Sentry中进行性能调试.

/**
 * Sentry 初始化（监控 + 性能追踪 + CPU 分析）
 *
 * 本文件必须在应用入口（src/index.ts）的最顶部导入，Sentry 才能完成自动插桩：
 * 它在加载时会包装 http、express、pg 等模块，晚于业务模块导入将采集不到这些调用。
 *
 * DSN 为空（如本地开发未配置）时直接跳过，避免无密钥导致初始化报错。
 */
if (dsn) {
    Sentry.init({
        dsn, // 上报地址，决定数据发往哪个 Sentry 项目

        // 环境标签，便于在 Sentry 中区分 development / production 的报错
        environment: process.env.NODE_ENV ?? "development",

        integrations: [nodeProfilingIntegration()], // 开启 CPU Profiling

        enableLogs: true, // 允许通过 Sentry.logger 上报结构化日志

        // 采样率 1.0 = 全量采集。生产环境流量大时应调低（如 0.1），避免配额迅速耗尽
        tracesSampleRate: 1.0, // 性能追踪（请求耗时、SQL 等）
        profileSessionSampleRate: 1.0, // 对多少比例的会话开启 CPU 分析

        profileLifecycle: "trace", // 分析随 trace 起止，而非全程常驻，降低开销

        // 附带 IP、请求头等默认个人标识信息。
        // 注意：涉及隐私合规（GDPR 等）时通常应关闭
        sendDefaultPii: true,
    });
}