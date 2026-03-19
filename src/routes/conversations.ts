import { Hono } from "hono";
import type { AppEnv } from "../types";

const conversations = new Hono<AppEnv>();

// tro chuyen & nhan tin
conversations.post("/protected/conversations", async (c) => {
  const { participantIds, isGroup = false } = await c.req.json();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  if (!participantIds || participantIds.length === 0) {
    return c.json({ error: "participantIds required" }, 400); // validate input
  }
  
  const allMembers = Array.from(new Set([user.userId, ...participantIds]));
// Tao conver moi 
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .insert({ is_group: isGroup })
    .select()
    .single();

  if (convErr) return c.json({ error: convErr.message }, 500);

  const memberInserts = allMembers.map((uid) => ({
    conversation_id: conv.conversation_id,
    user_id: uid,
  }));

  const { error: membersErr } = await supabase
    .from("conversation_members")
    .insert(memberInserts);

  if (membersErr) return c.json({ error: membersErr.message }, 500);

  return c.json({ message: "Conversation created", conversation: conv });
});

conversations.get("/protected/conversations", async (c) => {
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("conversation_members")
    .select(`
      conversation_id,
      conversations (is_group, created_at)
    `)
    .eq("user_id", user.userId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

conversations.get("/protected/conversations/:id/messages", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");
  
  const { data, error } = await supabase
    .from("messages")
    .select("*, users!sender_id(username, avatar)")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

conversations.post("/protected/conversations/:id/messages", async (c) => {
  const { id } = c.req.param();
  const { content } = await c.req.json();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: id,
      sender_id: user.userId,
      content,
    })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

conversations.put("/protected/messages/:id/read", async (c) => {
  const { id } = c.req.param();
  const supabase = c.get("supabase");

  const { error } = await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("id", id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "Seen" });
});

export default conversations;
