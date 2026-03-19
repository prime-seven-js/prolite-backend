import { Hono } from "hono";
import { cors } from "hono/cors";
import { verify, sign } from "hono/jwt";
import { createClient } from "@supabase/supabase-js";
import type { AppEnv } from "./types";

// Password hashing helper functions
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const hashedPassword = await hashPassword(password);
  return hashedPassword === hash;
}

const app = new Hono<AppEnv>();

// CORS middleware
app.use("*", cors());

// Middleware to attach Supabase client
app.use("*", async (c, next) => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
  c.set("supabase", supabase);
  await next();
});

// AuthN: Register route
app.post("/register", async (c) => {
  const { email, password, username, avatar, bio } = await c.req.json();

  // Use service role key for registration (bypasses RLS), fallback to anon key
  const supabaseKey =
    c.env.SUPABASE_SERVICE_ROLE_KEY || c.env.SUPABASE_ANON_KEY;
  const supabase = createClient(c.env.SUPABASE_URL, supabaseKey);

  // Hash password (simple example - use bcrypt in production)
  const hashedPassword = await hashPassword(password);

  const { data, error } = await supabase
    .from("users")
    .insert([
      {
        email,
        password: hashedPassword,
        username,
        avatar: avatar || null,
        bio: bio || null,
      },
    ])
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ message: "User registered successfully", user: data });
});

// Query registered users
app.get("/users", async (c) => {
  const supabase = c.get("supabase");
  const { data, error } = await supabase
    .from("users")
    .select("user_id, email, username, avatar, bio, created_at");
  if (error) {
    return c.json({ error: error.message }, 500);
  }
  return c.json(data);
});

// Query specific user
app.get("/users/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  const { data, error } = await supabase
    .from("users")
    .select("user_id, email, username, avatar, bio, created_at")
    .eq("user_id", id)
    .single();
  if (error) {
    return c.json({ error: error.message }, 404);
  }
  return c.json(data);
});

// AuthN: Login route
app.post("/login", async (c) => {
  const { email, username, password } = await c.req.json();
  const supabase = c.get("supabase");

  if (!email && !username) {
    return c.json({ error: "Email or username is required" }, 400);
  }

  if (!password) {
    return c.json({ error: "Password is required" }, 400);
  }

  // Query user from database by email or username
  let result;

  if (email) {
    result = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();
  } else {
    result = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .single();
  }

  const { data: user, error: queryError } = result;

  if (queryError || !user) {
    return c.json({ error: "Invalid email/username or password" }, 401);
  }

  // Verify password
  const passwordMatch = await verifyPassword(password, user.password);
  if (!passwordMatch) {
    return c.json({ error: "Invalid email/username or password" }, 401);
  }

  // Generate JWT token
  const payload = {
    userId: user.user_id,
    email: user.email,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
  };

  const token = await sign(payload, c.env.JWT_SECRET);
  return c.json({
    message: "Login successful",
    token,
    user: {
      userId: payload.userId,
      email: payload.email,
      username: payload.username,
    },
  });
});

// AuthZ: Protected route
app.use("/protected/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    c.set("jwtPayload", payload);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

app.get("/protected/posts/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  // Example: fetch post from Supabase
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    return c.json({ error: error.message }, 500);
  }
  return c.json(data);
});

app.get("/posts", async (c) => {
  const supabase = c.get("supabase");
  
  // Join users table to get the author's username
  const { data, error } = await supabase
    .from("posts")
    .select(`
      *,
      users ( username, avatar ),
      post_images ( image_url, position )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }
  return c.json(data);
});

app.get("/posts/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  const { data, error } = await supabase
    .from("posts")
    .select(`
      *,
      users ( username, avatar ),
      post_images ( image_url, position )
    `)
    .eq("post_id", id)
    .single();
  if (error) {
    return c.json({ error: error.message }, 404);
  }
  return c.json(data);
});

app.post("/protected/posts", async (c) => {
  const { content, privacy = "public", image_urls = [] } = await c.req.json();
  const supabase = c.get("supabase");
  const jwtPayload = c.get("jwtPayload");
  
  // 1. Insert Post
  const { data: postData, error: postError } = await supabase
    .from("posts")
    .insert({ 
      content, 
      privacy,
      user_id: jwtPayload.userId 
    })
    .select()
    .single();
    
  if (postError) {
    return c.json({ error: postError.message }, 500);
  }

  // 2. Insert Images (if any)
  if (image_urls && Array.isArray(image_urls) && image_urls.length > 0) {
    const imagesToInsert = image_urls.map((url: string, index: number) => ({
      post_id: postData.post_id,
      image_url: url,
      position: index,
    }));

    const { error: imagesError } = await supabase
      .from("post_images")
      .insert(imagesToInsert);

    if (imagesError) {
      console.error("Failed to insert post images:", imagesError);
    }
  }

  const { data: hydratedPost, error: hydratedPostError } = await supabase
    .from("posts")
    .select(`
      *,
      users ( username, avatar ),
      post_images ( image_url, position )
    `)
    .eq("post_id", postData.post_id)
    .single();

  if (hydratedPostError) {
    return c.json(postData);
  }

  return c.json(hydratedPost);
});

app.delete("/protected/posts/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("posts")
    .delete()
    .eq("post_id", id)
    .eq("user_id", user.userId) // chỉ cho phép chủ post xoá
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({
    message: "Post deleted",
    data,
  });
});
// comment

app.post("/protected/posts/:id/comments", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");

  const body = await c.req.json();
  const { content } = body;

  const { data, error } = await supabase
    .from("comments")
    .insert({
      post_id: id,
      content: content,
      user_id: c.get("jwtPayload").userId,
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json(data);
});

app.get("/posts/:id/comments", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");

  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json(data);
});

app.delete("/protected/comments/:id", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("comment_id", id)
    .eq("user_id", user.userId)
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ message: "Comment deleted", data });
});
export default app;