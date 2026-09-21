import { useEffect } from "react";
import { useAuth } from "@clerk/react";
import * as Sentry from "@sentry/react";

/** 保持哨兵用户上下文与Clerk同步（错误和重播显示哪个用户）. */
export function SentryUserSync() {
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    Sentry.setUser(userId ? { id: userId } : null);
  }, [isLoaded, userId]);

  return null;
}