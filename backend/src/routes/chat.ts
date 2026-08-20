import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpCreate, erpGet, erpList, erpRunMethod, erpUpdate } from "../lib/erp";
import { uploadFile } from "../lib/erpnext/files";
import { photoProxyUrl, safeErpFilePath } from "../lib/fabric-stock";
import {
  PEPE_EMAIL,
  applyContextPrefix,
  isImageType,
  normalizeRavenMessages,
  pickPepeChannelId,
  unwrapGetMessages,
  type ChatContext,
  type RawRavenMessage,
} from "../lib/pepe-chat";

export const chatRouter = new Hono();

type ChannelMember = { channel_id?: string; user_id?: string; user?: string };
type RavenChannel = { name?: string; is_direct_message?: number | boolean | string };

const TODO_FIELDS = ["name", "description", "status", "priority", "date", "allocated_to", "reference_type", "reference_name"];

function erpCreds() {
  return {
    base: (process.env.ERPNEXT_BASE_URL ?? "").replace(/\/$/, ""),
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

function authHeaders(key: string, secret: string): Record<string, string> {
  return {
    Authorization: `token ${key}:${secret}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
  };
}

async function memberChannelIds(email: string): Promise<string[]> {
  const rows = await erpList<ChannelMember>("Raven Channel Member", {
    filters: [["user_id", "=", email]],
    fields: ["channel_id", "user_id"],
    limit: 200,
  });
  const ids = rows.map((r) => String(r.channel_id ?? "")).filter(Boolean);
  if (ids.length) return ids;
  const fallback = await erpList<ChannelMember>("Raven Channel Member", {
    filters: [["user", "=", email]],
    fields: ["channel_id", "user"],
    limit: 200,
  });
  return fallback.map((r) => String(r.channel_id ?? "")).filter(Boolean);
}

async function directMessageIds(channelIds: string[]): Promise<string[]> {
  if (!channelIds.length) return [];
  const rows = await erpList<RavenChannel>("Raven Channel", {
    filters: [
      ["name", "in", channelIds],
      ["is_direct_message", "=", 1],
    ],
    fields: ["name", "is_direct_message"],
    limit: 200,
  });
  return rows.map((r) => String(r.name ?? "")).filter(Boolean);
}

async function resolvePepeChannelId(staffEmail: string): Promise<string | null> {
  const [staffIds, pepeIds] = await Promise.all([memberChannelIds(staffEmail), memberChannelIds(PEPE_EMAIL)]);
  const candidates = staffIds.filter((id) => pepeIds.includes(id));
  const dms = await directMessageIds(candidates);
  return pickPepeChannelId(staffIds, pepeIds, dms);
}

async function requireUser(c: Parameters<typeof getAuthedUser>[0]) {
  const user = await getAuthedUser(c);
  if (!user) return null;
  return user;
}

async function fetchMessagesViaGet(channelId: string): Promise<RawRavenMessage[] | "forbidden"> {
  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) return [];
  const url = new URL(`${base}/api/method/raven.api.chat_stream.get_messages`);
  url.searchParams.set("channel_id", channelId);
  const res = await fetch(url.toString(), { headers: authHeaders(key, secret) }).catch(() => null);
  if (!res) return [];
  if (res.status === 403 || res.status === 401) return "forbidden";
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { message?: unknown; data?: unknown } | null;
  return unwrapGetMessages(json?.message ?? json?.data ?? json);
}

async function fetchMessagesViaResource(channelId: string, limit: number): Promise<RawRavenMessage[]> {
  const rows = await erpList<RawRavenMessage>("Raven Message", {
    filters: [["channel_id", "=", channelId]],
    fields: ["name", "text", "owner", "creation", "message_type", "file", "is_bot_message"],
    order_by: "creation desc",
    limit,
  });
  return rows;
}

async function loadMessages(channelId: string, limit: number) {
  const viaGet = await fetchMessagesViaGet(channelId);
  const raw = viaGet === "forbidden" ? await fetchMessagesViaResource(channelId, limit) : viaGet;
  return normalizeRavenMessages(raw, (file) => photoProxyUrl(file) || "", limit);
}

function serializeTodo(t: {
  name: string;
  description?: string;
  status?: string;
  priority?: string;
  date?: string | null;
  allocated_to?: string | null;
  reference_type?: string | null;
  reference_name?: string | null;
}) {
  return {
    name: t.name,
    description: t.description ?? "",
    status: t.status ?? "Open",
    priority: t.priority ?? "Medium",
    date: t.date ?? null,
    allocated_to: t.allocated_to ?? null,
    reference_type: t.reference_type ?? null,
    reference_name: t.reference_name ?? null,
  };
}

// GET /api/chat/me
chatRouter.get("/me", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const pepeChannelId = await resolvePepeChannelId(user.email);
  return c.json({
    data: {
      user: { email: user.email, name: user.name },
      pepeChannelId,
    },
  });
});

// GET /api/chat/messages
chatRouter.get("/messages", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
  const pepeChannelId = await resolvePepeChannelId(user.email);
  if (!pepeChannelId) return c.json({ data: [] });
  try {
    const messages = await loadMessages(pepeChannelId, limit);
    return c.json({ data: messages });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "ERP error";
    return c.json({ error: { message } }, 500);
  }
});

// POST /api/chat/messages  { text } — ignore any client channel_id
chatRouter.post("/messages", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const body = await c.req.json().catch(() => ({})) as {
    text?: string;
    channel_id?: string;
    context?: ChatContext;
  };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: { message: "text required" } }, 400);

  const pepeChannelId = await resolvePepeChannelId(user.email);
  if (!pepeChannelId) return c.json({ error: { message: "unwired" } }, 409);

  const payload = applyContextPrefix(text, body.context ?? null);
  try {
    try {
      await erpRunMethod("raven.api.raven_message.send_message", {
        channel_id: pepeChannelId,
        text: payload,
        json_content: null,
        is_reply: 0,
        linked_message: null,
      });
    } catch {
      await erpCreate("Raven Message", {
        channel_id: pepeChannelId,
        text: payload,
        message_type: "Text",
        owner: user.email,
      });
    }
    const messages = await loadMessages(pepeChannelId, 50);
    return c.json({ data: messages });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Send failed";
    return c.json({ error: { message } }, 502);
  }
});

// POST /api/chat/upload
chatRouter.post("/upload", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const pepeChannelId = await resolvePepeChannelId(user.email);
  if (!pepeChannelId) return c.json({ error: { message: "unwired" } }, 409);

  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: { message: "Bad form data" } }, 400);
  }

  const rawFile = form["file"];
  const file = (Array.isArray(rawFile) ? rawFile[0] : rawFile) as File | undefined;
  if (!file || !(file instanceof File) || file.size === 0) {
    return c.json({ error: { message: "file is required" } }, 400);
  }

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const { fileUrl } = await uploadFile({
      file: buffer,
      filename: file.name || "upload.bin",
      contentType: file.type || "application/octet-stream",
      isPrivate: false,
    });
    const path = safeErpFilePath(fileUrl) || fileUrl;
    const image = isImageType(file.name || "", file.type || "");
    await erpCreate("Raven Message", {
      channel_id: pepeChannelId,
      text: file.name || (image ? "Image" : "File"),
      message_type: image ? "Image" : "File",
      file: path,
      owner: user.email,
    });
    const messages = await loadMessages(pepeChannelId, 50);
    return c.json({ data: messages });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return c.json({ error: { message } }, 502);
  }
});

// GET /api/chat/todos — this login only
chatRouter.get("/todos", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const rows = await erpList<{
      name: string;
      description?: string;
      status?: string;
      priority?: string;
      date?: string | null;
      allocated_to?: string | null;
      reference_type?: string | null;
      reference_name?: string | null;
    }>("ToDo", {
      filters: [
        ["status", "=", "Open"],
        ["allocated_to", "=", user.email],
      ],
      fields: TODO_FIELDS,
      order_by: "date asc",
      limit: 100,
    });
    return c.json({ data: rows.map(serializeTodo) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "ERP error";
    return c.json({ error: { message } }, 500);
  }
});

// POST /api/chat/todos/:id/close
chatRouter.post("/todos/:id/close", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = c.req.param("id");
  try {
    const existing = await erpGet<{ name: string; allocated_to?: string | null; status?: string }>("ToDo", id);
    if (!existing) return c.json({ error: { message: "Not found" } }, 404);
    if (existing.allocated_to !== user.email) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
    const updated = await erpUpdate<{ name: string; status?: string; allocated_to?: string | null }>("ToDo", id, {
      status: "Closed",
    });
    return c.json({ data: serializeTodo({ ...existing, ...updated, status: "Closed" }) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "ERP error";
    return c.json({ error: { message } }, 500);
  }
});
