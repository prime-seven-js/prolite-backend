import { Hono } from "hono";
import type { AppEnv } from "../types";

const likes = new Hono<AppEnv>();

//  Like bai viet
likes.post("/protected/posts/:id/like", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data: existingLike } = await supabase
    .from("post_likes")
    .select("id")
    .eq("post_id", id)
    .eq("user_id", user.userId)
    .single();

  if (existingLike) {
    const { error } = await supabase
      .from("post_likes")
      .delete()
      .eq("id", existingLike.id);
    
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ message: "Post unliked" });
  } else {
    const { data, error } = await supabase
      .from("post_likes")
      .insert({ post_id: id, user_id: user.userId })
      .select()
      .single();
      
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ message: "Post liked", data });
  }
});

likes.get("/posts/:id/likes", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  const { data, error } = await supabase
    .from("post_likes")
    .select("user_id, users(username, avatar)")
    .eq("post_id", id);
    
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// cmt like
likes.post("/protected/comments/:id/like", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data: existingLike } = await supabase
    .from("comment_likes")
    .select("id")
    .eq("comment_id", id)
    .eq("user_id", user.userId)
    .single();

  if (existingLike) {
    const { error } = await supabase
      .from("comment_likes")
      .delete()
      .eq("id", existingLike.id);
    
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ message: "Comment unliked" });
  } else {
    const { data, error } = await supabase
      .from("comment_likes")
      .insert({ comment_id: id, user_id: user.userId })
      .select()
      .single();
      
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ message: "Comment liked", data });
  }
});

export default likes;
