import { Hono } from "hono";
import type { AppEnv } from "../types";

const notifications = new Hono<AppEnv>();

// noti
notifications.get("/protected/notifications", async (c) => {
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

notifications.put("/protected/notifications/read-all", async (c) => {
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", user.userId)
    .eq("is_read", false);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "All notifications marked as read" });
});

export default notifications;
