import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";

export const filesRouter = new Hono();

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
