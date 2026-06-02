import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const ravenRouter = new Hono();

const ERP_BASE = "https://erp.lstailors.com";

function erpAuthHeader(): string {
  const key = process.env.ERPNEXT_API_KEY;
  const secret = process.env.ERPNEXT_API_SECRET;
  return `token ${key}:${secret}`;
}

async function erpGet(path: string): Promise<any> {
  const res = await fetch(`${ERP_BASE}${path}`, {
    headers: { Authorization: erpAuthHeader() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ERPNext error ${res.status}: ${text}`);
  }
  return res.json();
}

async function erpPost(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${ERP_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: erpAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ERPNext error ${res.status}: ${text}`);
  }
  return res.json();
}

// GET /api/raven/channels
ravenRouter.get("/channels", async (c) => {
  await getAuthedUser(c);
  const fields = JSON.stringify(["name", "channel_name", "type", "is_archived", "workspace"]);
  const filters = JSON.stringify([["is_archived", "=", 0]]);
  const json = await erpGet(
    `/api/resource/Raven%20Channel?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit=50`
  );
  const channels = (json.data ?? []).map((ch: any) => ({
    name: ch.name,
    channel_name: ch.channel_name,
    type: ch.type,
    workspace: ch.workspace,
  }));
  return c.json({ data: channels });
});

// GET /api/raven/channels/:channelId/messages
ravenRouter.get("/channels/:channelId/messages", async (c) => {
  await getAuthedUser(c);
  const channelId = decodeURIComponent(c.req.param("channelId"));
  const limit = Number(c.req.query("limit") ?? 50);
  const start = Number(c.req.query("start") ?? 0);
  const fields = JSON.stringify([
    "name",
    "channel_id",
    "text",
    "owner",
    "creation",
    "message_type",
    "file_thumbnail_width",
    "file_thumbnail_height",
  ]);
  const filters = JSON.stringify([["channel_id", "=", channelId]]);
  const json = await erpGet(
    `/api/resource/Raven%20Message?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=creation%20asc&limit=${limit}&limit_start=${start}`
  );
  const messages = (json.data ?? []).map((m: any) => ({
    name: m.name,
    channel_id: m.channel_id,
    text: m.text,
    owner: m.owner,
    creation: m.creation,
    message_type: m.message_type,
  }));
  return c.json({ data: messages });
});

// POST /api/raven/channels/:channelId/messages
ravenRouter.post("/channels/:channelId/messages", async (c) => {
  const user = await getAuthedUser(c);
  const channelId = decodeURIComponent(c.req.param("channelId"));
  const body = await c.req.json<{ text: string }>();
  const json = await erpPost("/api/resource/Raven%20Message", {
    channel_id: channelId,
    text: body.text,
    message_type: "Text",
    owner: user.email,
  });
  const doc = json.data ?? json;
  return c.json({
    data: {
      name: doc.name,
      text: doc.text,
      creation: doc.creation,
    },
  });
});

// GET /api/raven/users
ravenRouter.get("/users", async (c) => {
  await getAuthedUser(c);
  const fields = JSON.stringify(["name", "full_name", "user"]);
  const json = await erpGet(
    `/api/resource/Raven%20User?fields=${encodeURIComponent(fields)}&limit=50`
  );
  return c.json({ data: json.data ?? [] });
});
