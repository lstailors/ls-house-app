import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";
import { safeErpFilePath } from "../lib/fabric-stock";

export const filesRouter = new Hono();

function erpCreds() {
  return {
    base: (process.env.ERPNEXT_BASE_URL ?? "").replace(/\/$/, ""),
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

function imageTypeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57) {
    return "image/webp";
  }
  return null;
}

async function fetchErpFile(path: string): Promise<{ bytes: Uint8Array; type: string } | { error: string; status: number }> {
  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) return { error: "ERPNext not configured", status: 500 };

  const headers = {
    Authorization: `token ${key}:${secret}`,
    Accept: "image/*,application/octet-stream",
  };

  const candidates = [
    `${base}/api/method/frappe.utils.file_manager.download_file?file_url=${encodeURIComponent(path)}`,
    `${base}/api/method/frappe.core.doctype.file.file.download_file?file_url=${encodeURIComponent(path)}`,
    erpFileAbsoluteUrl(path),
  ];

  let lastStatus = 502;
  for (const url of candidates) {
    const res = await fetch(url, { headers }).catch(() => null);
    if (!res) continue;
    lastStatus = res.status;
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const headerType = res.headers.get("content-type") || "";
    if (headerType.includes("text/html") || headerType.includes("application/json")) {
      const magic = imageTypeFromBytes(bytes);
      if (!magic) continue;
      return { bytes, type: magic };
    }
    const magic = imageTypeFromBytes(bytes);
    return { bytes, type: magic || (headerType.startsWith("image/") ? headerType : "image/jpeg") };
  }

  return { error: `ERP file ${lastStatus}`, status: lastStatus === 404 ? 404 : 502 };
}

/** GET /api/files/erp?path=/private/files/... — authenticated ERP file proxy for private photos. */
filesRouter.get("/erp", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const path = safeErpFilePath(c.req.query("path") || "");
  if (!path) return c.json({ error: { message: "Invalid file path" } }, 400);

  const result = await fetchErpFile(path);
  if ("error" in result) {
    return c.json({ error: { message: result.error } }, result.status as 400 | 404 | 500 | 502);
  }

  return new Response(result.bytes, {
    status: 200,
    headers: {
      "Content-Type": result.type,
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
