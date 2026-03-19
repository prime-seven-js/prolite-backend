import { Hono } from "hono";
import type { AppEnv } from "../types";
import { adminGuard } from "../middlewares/adminGuard";

const admin = new Hono<AppEnv>();

// xac thuc admin
admin.use("/protected/admin/*", adminGuard);

// ─── Dashboard Stats ────────────────────────────────────────
admin.get("/protected/admin/stats", async (c) => {
  const supabase = c.get("supabase");

  const [users, posts, comments] = await Promise.all([
    supabase.from("users").select("user_id", { count: "exact", head: true }),
    supabase.from("posts").select("post_id", { count: "exact", head: true }),
    supabase.from("comments").select("comment_id", { count: "exact", head: true }),
  ]);

  return c.json({
    totalUsers: users.count ?? 0,
    totalPosts: posts.count ?? 0,
    totalComments: comments.count ?? 0,
  });
});

// ─── Users CRUD ─────────────────────────────────────────────

// GET: lay dsach user 
admin.get("/protected/admin/users", async (c) => {
  const supabase = c.get("supabase");

  const { data, error } = await supabase
    .from("users")
    .select("user_id, username, email, avatar, bio, role, created_at")
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// POST: tao user
admin.post("/protected/admin/users", async (c) => {
  const body = await c.req.json();
  const { email, username, password, role = "user", bio, avatar } = body;

  if (!email || !username || !password) {
    return c.json({ error: "email, username, password are required" }, 400);
  }

  // Hash password
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  const hashedPassword = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const supabaseKey = c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, supabaseKey);

  const { data, error } = await supabase
    .from("users")
    .insert({ email, username, password: hashedPassword, role, bio: bio || null, avatar: avatar || null })
    .select("user_id, username, email, avatar, bio, role, created_at")
    .single();

  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

// PUT: cập nhật thông tin user (không cho sửa password ở đây)
admin.put("/protected/admin/users/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { username, email, bio, avatar, role } = body;

  const supabaseKey = c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, supabaseKey);

  const updateData: Record<string, string | null> = {};
  if (username !== undefined) updateData.username = username;
  if (email !== undefined) updateData.email = email;
  if (bio !== undefined) updateData.bio = bio;
  if (avatar !== undefined) updateData.avatar = avatar;
  if (role !== undefined) updateData.role = role;

  const { data, error } = await supabase
    .from("users")
    .update(updateData)
    .eq("user_id", id)
    .select("user_id, username, email, avatar, bio, role, created_at")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "User not found" }, 404);
  return c.json(data);
});

// PUT: reset password (sinh mật khẩu ngẫu nhiên)
admin.put("/protected/admin/users/:id/reset-password", async (c) => {
  const { id } = c.req.param();

  // create pw ngau nhien trong truong hop admin quen mat khau cua user va muon reset cho user do
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
  const newPassword = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => chars[b % chars.length])
    .join("");

  // Hash
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(newPassword));
  const hashedPassword = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const supabaseKey = c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, supabaseKey);

  const { error } = await supabase
    .from("users")
    .update({ password: hashedPassword })
    .eq("user_id", id);

  if (error) return c.json({ error: error.message }, 500);

  // return pwd cho admin 
  return c.json({ message: "Password reset successful", newPassword });
});

// DELETE: xoa user
admin.delete("/protected/admin/users/:id", async (c) => {
  const { id } = c.req.param();

  const supabaseKey = c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, supabaseKey);

  const { error } = await supabase.from("users").delete().eq("user_id", id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "User deleted" });
});

// ─── Posts Management ───────────────────────────────────────

admin.get("/protected/admin/posts", async (c) => {
  const supabase = c.get("supabase");

  const { data, error } = await supabase
    .from("posts")
    .select("*, users(username, avatar)")
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.delete("/protected/admin/posts/:id", async (c) => {
  const { id } = c.req.param();

  const supabaseKey = c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(c.env.SUPABASE_URL, supabaseKey);

  const { error } = await supabase.from("posts").delete().eq("post_id", id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "Post deleted" });
});

export default admin;
