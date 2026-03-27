import { Hono } from "hono";
import type { AppEnv } from "../types";

const conversations = new Hono<AppEnv>();

// ─── POST /protected/conversations ───────────────────────────────────────────
// Tạo conversation 1-1. Nếu DM giữa 2 người đã tồn tại → trả về conversation cũ.
conversations.post("/protected/conversations", async (c) => {
  const { participantIds } = await c.req.json();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload") as { userId: string };

  if (!participantIds || participantIds.length === 0) {
    return c.json({ error: "participantIds required" }, 400);
  }

  const targetUserId = participantIds[0] as string;

  // Tìm conversation 1-1 đã tồn tại giữa 2 người
  const { data: myConvs } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", user.userId);

  if (myConvs && myConvs.length > 0) {
    const myConvIds = (myConvs as { conversation_id: string }[]).map(
      (r) => r.conversation_id,
    );

    const { data: shared } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", targetUserId)
      .in("conversation_id", myConvIds);

    if (shared && shared.length > 0) {
      for (const row of shared as { conversation_id: string }[]) {
        const { data: members } = await supabase
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", row.conversation_id);

        // Đây là DM 1-1 (chỉ 2 members) → trả về luôn
        if (members && members.length === 2) {
          return c.json({
            message: "Conversation already exists",
            conversation: { conversation_id: row.conversation_id },
          });
        }
      }
    }
  }

  // Tạo conversation mới
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .insert({ is_group: false })
    .select()
    .single();

  if (convErr) return c.json({ error: convErr.message }, 500);

  const memberInserts = [user.userId, targetUserId].map((uid) => ({
    conversation_id: conv.conversation_id,
    user_id: uid,
  }));

  const { error: membersErr } = await supabase
    .from("conversation_members")
    .insert(memberInserts);

  if (membersErr) return c.json({ error: membersErr.message }, 500);

  // Phát broadcast event báo có conversation mới (Sử dụng httpSend để tránh warning fallback REST của Supabase)
  const globalChannel = supabase.channel("conversations-realtime");
  await (globalChannel as any).httpSend("NEW_CONVERSATION", { 
    conversation_id: conv.conversation_id 
  });

  return c.json({ message: "Conversation created", conversation: conv });
});

// ─── GET /protected/conversations ────────────────────────────────────────────
// Trả về conversations enriched: participants (username, avatar) + last_message.
conversations.get("/protected/conversations", async (c) => {
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  // 1. Lấy danh sách conversation_id của current user
  const { data: myConvs, error: myConvsErr } = await supabase
    .from("conversation_members")
    .select("conversation_id, conversations(is_group, created_at)")
    .eq("user_id", user.userId);

  if (myConvsErr) return c.json({ error: myConvsErr.message }, 500);
  if (!myConvs || myConvs.length === 0) return c.json([]);

  const convIds = (
    myConvs as { conversation_id: string }[]
  ).map((r) => r.conversation_id);

  // 2. Lấy tất cả members của các conversations (để resolve participants)
  const { data: allMembers, error: membersErr } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id, users(username, avatar)")
    .in("conversation_id", convIds);

  if (membersErr) return c.json({ error: membersErr.message }, 500);

  // 3. Lấy last message của mỗi conversation (chỉ cần 1 cái mới nhất mỗi conv)
  const { data: lastMessages, error: lastMsgErr } = await supabase
    .from("messages")
    .select("conversation_id, content, sender_id, created_at")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: false });

  if (lastMsgErr) return c.json({ error: lastMsgErr.message }, 500);

  // Build map: conversation_id → last message (đã order desc nên lấy phần tử đầu tiên gặp)
  const lastMsgMap = new Map<
    string,
    { content: string; sender_id: string; created_at: string }
  >();
  for (const msg of (lastMessages ?? []) as {
    conversation_id: string;
    content: string;
    sender_id: string;
    created_at: string;
  }[]) {
    if (!lastMsgMap.has(msg.conversation_id)) {
      lastMsgMap.set(msg.conversation_id, {
        content: msg.content,
        sender_id: msg.sender_id,
        created_at: msg.created_at,
      });
    }
  }

  // Build map: conversation_id → participants[]
  const participantsMap = new Map<
    string,
    { user_id: string; username: string; avatar?: string }[]
  >();
  for (const m of (allMembers ?? []) as {
    conversation_id: string;
    user_id: string;
    users: { username: string; avatar?: string };
  }[]) {
    if (!participantsMap.has(m.conversation_id)) {
      participantsMap.set(m.conversation_id, []);
    }
    participantsMap.get(m.conversation_id)!.push({
      user_id: m.user_id,
      username: m.users?.username ?? "Unknown",
      avatar: m.users?.avatar,
    });
  }

  // 4. Compose & sort (mới nhất trước)
  const enriched = (
    myConvs as {
      conversation_id: string;
      conversations: { is_group: boolean; created_at: string };
    }[]
  ).map((row) => ({
    conversation_id: row.conversation_id,
    conversations: row.conversations,
    participants: participantsMap.get(row.conversation_id) ?? [],
    last_message: lastMsgMap.get(row.conversation_id) ?? null,
  }));

  enriched.sort((a, b) => {
    const ta = a.last_message?.created_at ?? a.conversations?.created_at ?? "";
    const tb = b.last_message?.created_at ?? b.conversations?.created_at ?? "";
    return tb.localeCompare(ta);
  });

  return c.json(enriched);
});

// ─── GET /protected/conversations/:id/messages ───────────────────────────────
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

// ─── POST /protected/conversations/:id/messages ──────────────────────────────
conversations.post("/protected/conversations/:id/messages", async (c) => {
  const { id } = c.req.param();
  const { content } = await c.req.json();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: id, sender_id: user.userId, content })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  // Phát broadcast message mới cho channel riêng biệt của conversation này (Dùng httpSend)
  const msgChannel = supabase.channel(`messages-${id}`);
  await (msgChannel as any).httpSend("NEW_MESSAGE", data);

  // Phát broadcast chung báo có cập nhật message để ConversationList refresh (Dùng httpSend)
  const globalChannel = supabase.channel("conversations-realtime");
  await (globalChannel as any).httpSend("NEW_MESSAGE", { 
    conversation_id: id 
  });

  return c.json(data);
});

// ─── PUT /protected/messages/:id/read ────────────────────────────────────────
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
