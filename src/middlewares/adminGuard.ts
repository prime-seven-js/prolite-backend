import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

/**
 * Middleware: chặn truy cập nếu user không phải admin.
 * Phải đặt SAU middleware xác thực JWT (/protected/*).
 */
export const adminGuard = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("jwtPayload");

  if (user.role !== "admin") {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }

  await next();
});
