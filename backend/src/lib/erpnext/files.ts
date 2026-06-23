// ERPNext File upload + public URL helpers (replaces Supabase Storage).
import { erpRunMethod } from "../erp";

function creds() {
  return {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

export interface UploadFileOpts {
  file: Blob | Buffer | Uint8Array;
  filename: string;
  contentType?: string;
  doctype?: string;
  docname?: string;
  folder?: string;
  isPrivate?: boolean;
}

export async function uploadFile(opts: UploadFileOpts): Promise<{ fileUrl: string; fileId: string }> {
  const { base, key, secret } = creds();
  if (!base || !key || !secret) throw new Error("ERPNext not configured");

  const form = new FormData();
  const blob =
    opts.file instanceof Blob
      ? opts.file
      : new Blob([opts.file as BlobPart], { type: opts.contentType ?? "application/octet-stream" });
  form.append("file", blob, opts.filename);
  if (opts.doctype) form.append("doctype", opts.doctype);
  if (opts.docname) form.append("docname", opts.docname);
  if (opts.folder) form.append("folder", opts.folder);
  form.append("is_private", opts.isPrivate ? "1" : "0");

  const res = await fetch(`${base}/api/method/upload_file`, {
    method: "POST",
    headers: { Authorization: `token ${key}:${secret}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err._server_messages || err.exception || `Upload failed: ${res.status}`);
  }

  const json = await res.json() as { message?: { file_url?: string; name?: string } };
  const msg = json.message ?? {};
  const fileUrl = msg.file_url ?? "";
  const fileId = msg.name ?? "";
  if (!fileUrl) throw new Error("Upload succeeded but no file URL returned");
  return { fileUrl, fileId };
}

/** Attach a file URL to a document field (e.g. lsh_photos child table). */
export async function attachFileUrl(
  doctype: string,
  docname: string,
  fieldname: string,
  fileUrl: string,
): Promise<void> {
  await erpRunMethod("frappe.client.set_value", {
    doctype,
    name: docname,
    fieldname,
    value: fileUrl,
  }).catch(() => {});
}

/** Build absolute URL for an ERPNext file path. */
export function erpFileAbsoluteUrl(fileUrl: string): string {
  if (!fileUrl) return "";
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = (process.env.ERPNEXT_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
}
