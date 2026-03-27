import { Hono } from "hono";
import type { AppEnv } from "../ types";

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

  // Chữ ký duy nhất cho cuộc trò chuyện 1-1
  const dmKey = [user.userId, targetUserId].sort().join("_");

  // 1. TÌM HỘI THOẠI ĐÃ TỒN TẠI (Giờ ta dùng luôn dm_key siêu nhanh, hoặc fallback logic cho các DM cũ)
  // Vì có dm_key ở Database, thao tác tìm kiếm đã tồn tại giờ chỉ cần 1 query duy nhất!
  const { data: existingByKey } = await supabase
    .from("conversations")
    .select("conversation_id")
    .eq("dm_key", dmKey)
    .single();

  if (existingByKey) {
    return c.json({
      message: "Conversation already exists",
      conversation: { conversation_id: existingByKey.conversation_id },
    });
  }

  // --- Fallback tìm DB cũ (những hội thoại tạo trước khi có dm_key) ---
  const { data: myConvs } = await supabase
    .from("conversation_members")
    .select("conversation_id, conversations!inner(is_group)")
    .eq("user_id", user.userId)
    .eq("conversations.is_group", false);

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
      const sharedConvIds = shared.map((s: any) => s.conversation_id);

      const { data: allMembers } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", sharedConvIds);

      if (allMembers) {
        const convMap = new Map<string, string[]>();
        for (const m of allMembers) {
          if (!convMap.has(m.conversation_id)) convMap.set(m.conversation_id, []);
          const arr = convMap.get(m.conversation_id)!;
          if (!arr.includes(m.user_id)) arr.push(m.user_id);
        }

        const targetParticipants = Array.from(new Set([user.userId, targetUserId])).sort();

        for (const [cId, members] of convMap.entries()) {
          const sortedMembers = [...members].sort();
          if (
            sortedMembers.length === targetParticipants.length &&
            sortedMembers.every((val, index) => val === targetParticipants[index])
          ) {
             return c.json({
               message: "Conversation already exists",
               conversation: { conversation_id: cId },
             });
          }
        }
      }
    }
  }

  // 2. TẠO MỚI (Database tự động văng lỗi 23505 nếu có người khác đang tạo trùng dm_key ở cùng 1 thời điểm - chặn 100% Race Condition)
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .insert({ is_group: false, dm_key: dmKey })
    .select()
    .single();

  if (convErr) {
    if (convErr.code === "23505" || convErr.message?.includes("unique")) {
      // Race condition bị Database cản lại. Lấy lại đúng cái hội thoại mà người kia vừa lưu nhanh hơn.
      const { data: raceExisting } = await supabase
        .from("conversations")
        .select("conversation_id")
        .eq("dm_key", dmKey)
        .single();
        
      if (raceExisting) {
        return c.json({
          message: "Conversation already exists",
          conversation: { conversation_id: raceExisting.conversation_id },
        });
      }
    }
    return c.json({ error: convErr.message }, 500);
  }

  // Dùng Set() để nếu userID === targetUserId (chat 1 mình), chỉ insert 1 row
  const uniqueMemberIds = Array.from(new Set([user.userId, targetUserId]));
  const memberInserts = uniqueMemberIds.map((uid) => ({
    conversation_id: conv.conversation_id,
    user_id: uid,
  }));

  const { error: membersErr } = await supabase
    .from("conversation_members")
    .insert(memberInserts);

  if (membersErr) return c.json({ error: membersErr.message }, 500);

  // Phát broadcast event báo có conversation mới
  const globalChannel = supabase.channel("conversations-realtime");
  await (globalChannel as any).httpSend("NEW_CONVERSATION", {
    conversation_id: conv.conversation_id,
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

  const convIds = (myConvs as { conversation_id: string }[]).map(
    (r) => r.conversation_id,
  );

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
    const currentList = participantsMap.get(m.conversation_id)!;
    if (!currentList.some((p) => p.user_id === m.user_id)) {
      currentList.push({
        user_id: m.user_id,
        username: m.users?.username ?? "Unknown",
        avatar: m.users?.avatar,
      });
    }
  }

  // 4. Compose & sort (mới nhất trước)
  const uniqueConvsMap = new Map();
  for (const row of myConvs as any[]) {
    if (!uniqueConvsMap.has(row.conversation_id)) {
      uniqueConvsMap.set(row.conversation_id, row);
    }
  }

  const enriched = Array.from(uniqueConvsMap.values()).map((row) => ({
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

  // 5. Deduplicate 1-1 conversations by the other participant
  const seen1on1 = new Set<string>();
  const finalEnriched = [];

  for (const conv of enriched) {
    if (!conv.conversations?.is_group) {
      const otherParticipant = conv.participants.find(
        (p: any) => p.user_id !== user.userId,
      );
      const otherId = otherParticipant ? otherParticipant.user_id : user.userId;

      if (seen1on1.has(otherId)) {
        continue; // Bỏ qua conversation 1-1 bị trùng với người này (chỉ giữ cái mới nhất)
      }
      seen1on1.add(otherId);
    }
    finalEnriched.push(conv);
  }

  return c.json(finalEnriched);
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
    conversation_id: id,
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
