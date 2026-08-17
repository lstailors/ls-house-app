import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";
import { safeErpFilePath } from "../lib/fabric-stock";

export const filesRouter = new Hono();

function erpCreds() {
  return {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

/** GET /api/files/erp?path=/files/YZSTK-081.jpg — authenticated ERP file proxy. */
filesRouter.get("/erp", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const path = safeErpFilePath(c.req.query("path") || "");
  if (!path) return c.json({ error: { message: "Invalid file path" } }, 400);

  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) return c.json({ error: { message: "ERPNext not configured" } }, 500);

  const url = erpFileAbsoluteUrl(path);
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${key}:${secret}`,
      Accept: "image/*,application/octet-stream",
      "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
    },
  });
  if (!res.ok) {
    return c.json({ error: { message: `ERP file ${res.status}` } }, res.status === 404 ? 404 : 502);
  }

  const type = res.headers.get("content-type") || "application/octet-stream";
  if (type.includes("text/html") || type.includes("application/json")) {
    return c.json({ error: { message: "ERP did not return an image" } }, 502);
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=300",
    },
  });
});

// POST /api/files/upload — multipart upload to ERPNext File
filesRouter.post("/upload", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

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

  const doctype = String(form["doctype"] ?? "").trim() || undefined;
  const docname = String(form["docname"] ?? "").trim() || undefined;

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const { fileUrl, fileId } = await uploadFile({
      file: buffer,
      filename: file.name || "upload.bin",
      contentType: file.type || "application/octet-stream",
      doctype,
      docname,
      isPrivate: false,
    });

    return c.json({
      data: {
        url: erpFileAbsoluteUrl(fileUrl),
        fileId,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return c.json({ error: { message } }, 500);
  }
});
