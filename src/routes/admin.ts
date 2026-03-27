import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { adminGuard } from "../middlewares/adminGuard";

const admin = new Hono<AppEnv>();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const hashPassword = async (password: string) => {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(password));

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const getAdminSupabase = (c: {
  env: AppEnv["Bindings"];
}) =>
  createClient(
    c.env.SUPABASE_URL,
    c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY,
  );

const getPagination = (c: { req: { query: (key: string) => string | undefined } }) => {
  const page = Math.max(
    Number.parseInt(c.req.query("page") || `${DEFAULT_PAGE}`, 10) || DEFAULT_PAGE,
    1,
  );
  const limit = Math.min(
    Math.max(
      Number.parseInt(c.req.query("limit") || `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT,
      1,
    ),
    MAX_LIMIT,
  );
  const start = (page - 1) * limit;

  return { start, limit };
};

const updateUserPassword = async (
  c: {
    env: AppEnv["Bindings"];
    req: {
      param: () => { id: string };
      json: () => Promise<{ newPassword?: string }>;
    };
    json: (body: unknown, status?: number) => Response;
  },
) => {
  const { id } = c.req.param();
  const { newPassword } = await c.req.json();

  if (!newPassword || typeof newPassword !== "string") {
    return c.json({ error: "newPassword is required" }, 400);
  }

  const hashedPassword = await hashPassword(newPassword);
  const supabase = getAdminSupabase(c);

  const { data, error } = await supabase
    .from("users")
    .update({ password: hashedPassword })
    .eq("user_id", id)
    .select("user_id")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "User not found" }, 404);

  return c.json({ message: "Password reset successful" });
};

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

admin.get("/protected/admin/users", async (c) => {
  const supabase = c.get("supabase");
  const { start, limit } = getPagination(c);
  const search = c.req.query("search")?.trim();

  let query = supabase
    .from("users")
    .select("user_id, username, email, avatar, bio, role, created_at")
    .order("created_at", { ascending: false })
    .range(start, start + limit - 1);

  if (search) {
    query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error } = await query;

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.get("/protected/admin/users/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");

  const { data, error } = await supabase
    .from("users")
    .select("user_id, username, email, avatar, bio, role, created_at")
    .eq("user_id", id)
    .single();

  if (error) return c.json({ error: error.message }, 404);
  return c.json(data);
});

admin.post("/protected/admin/users", async (c) => {
  const body = await c.req.json();
  const { email, username, password, role = "user", bio, avatar } = body;

  if (!email || !username || !password) {
    return c.json({ error: "email, username, password are required" }, 400);
  }

  const hashedPassword = await hashPassword(password);
  const supabase = getAdminSupabase(c);

  const { data, error } = await supabase
    .from("users")
    .insert({
      email,
      username,
      password: hashedPassword,
      role,
      bio: bio || null,
      avatar: avatar || null,
    })
    .select("user_id, username, email, avatar, bio, role, created_at")
    .single();

  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

admin.put("/protected/admin/users/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { username, email, bio, avatar, role } = body;
  const supabase = getAdminSupabase(c);

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

admin.put("/protected/admin/users/:id/password", updateUserPassword);

// Backward-compatible alias for current admin frontend behavior.
admin.put("/protected/admin/users/:id/reset-password", updateUserPassword);

admin.delete("/protected/admin/users/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = getAdminSupabase(c);

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
  const supabase = getAdminSupabase(c);

  const { error } = await supabase.from("posts").delete().eq("post_id", id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "Post deleted" });
});

// ─── Comments Management ────────────────────────────────────

admin.get("/protected/admin/comments", async (c) => {
  const supabase = c.get("supabase");

  const { data, error } = await supabase
    .from("comments")
    .select("comment_id, post_id, user_id, content, created_at, users(username, avatar), posts(content)")
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.delete("/protected/admin/comments/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = getAdminSupabase(c);

  const { error } = await supabase.from("comments").delete().eq("comment_id", id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "Comment deleted" });
});

export default admin;
