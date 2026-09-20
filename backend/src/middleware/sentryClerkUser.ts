import type { RequestHandler } from "express";
import * as Sentry from "@sentry/node";
import { getAuth } from "@clerk/express";

/** 将Clerk用户id附加到请求隔离作用域，以便错误包括已登录的用户 */
export const sentryClerkUserMiddleware: RequestHandler = (req, _res, next) => {
  const { userId } = getAuth(req);
  Sentry.getIsolationScope().setUser(userId ? { id: userId } : null);
  next();
};