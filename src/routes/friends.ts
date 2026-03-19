import { Hono } from "hono";
import type { AppEnv } from "../types";

const friends = new Hono<AppEnv>();

// ban be 
friends.post("/protected/friends/request/:userId", async (c) => {
  const { userId } = c.req.param();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  if (userId === user.userId) {
    return c.json({ error: "Cannot send friend request to yourself" }, 400);
  }

  const { data: existing } = await supabase
    .from("friendships")
    .select("id, status")
    .or(`and(requester_id.eq.${user.userId},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${user.userId})`)
    .single();

  if (existing) {
    return c.json({ error: "Friend request already exists: " + existing.status }, 400);
  }

  const { data, error } = await supabase
    .from("friendships")
    .insert({ requester_id: user.userId, addressee_id: userId, status: "pending" })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "Friend request sent", data });
});

friends.put("/protected/friends/accept/:friendshipId", async (c) => {
  const { friendshipId } = c.req.param();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", friendshipId)
    .eq("addressee_id", user.userId)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "Friend request not found" }, 404);
  return c.json({ message: "Friend request accepted", data });
});

friends.put("/protected/friends/decline/:friendshipId", async (c) => {
  const { friendshipId } = c.req.param();
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId)
    .eq("addressee_id", user.userId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ message: "Friend request declined" });
});

friends.get("/protected/friends/pending", async (c) => {
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("friendships")
    .select("id, created_at, users!requester_id(user_id, username, avatar)")
    .eq("addressee_id", user.userId)
    .eq("status", "pending");

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

friends.get("/protected/friends", async (c) => {
  const supabase = c.get("supabase");
  const user = c.get("jwtPayload");

  const { data, error } = await supabase
    .from("friendships")
    .select(`
      id,
      created_at,
      requester:users!requester_id(user_id, username, avatar),
      addressee:users!addressee_id(user_id, username, avatar)
    `)
    .or(`requester_id.eq.${user.userId},addressee_id.eq.${user.userId}`)
    .eq("status", "accepted");

  if (error) return c.json({ error: error.message }, 500);

  const formattedFriends = data.map((f: any) => {
    const friend = f.requester.user_id === user.userId ? f.addressee : f.requester;
    return {
      friendship_id: f.id,
      friend_since: f.created_at,
      ...friend
    };
  });

  return c.json(formattedFriends);
});

export default friends;
