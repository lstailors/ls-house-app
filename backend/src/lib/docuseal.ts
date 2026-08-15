/** DocuSeal signing — optional. If unset, the phone uses an on-device signature pad. */

import { loadDocusealSettings } from "./qc-settings";

const FALLBACK_URL = "https://docuseal.lstailors.com";

export async function docusealEnabled() {
  const s = await loadDocusealSettings();
  return Boolean(s.apiKey);
}

export type DocuSealSubmission = {
  id: string | number;
  embedSrc: string | null;
  slug?: string;
};

export async function createQcSignatureSubmission(opts: {
  title: string;
  inspectorEmail: string;
  inspectorName: string;
  pdfBytes?: ArrayBuffer | null;
  pdfName?: string;
}): Promise<DocuSealSubmission | null> {
  const cfg = await loadDocusealSettings();
  if (!cfg.apiKey) return null;

  const templateId = (process.env.DOCUSEAL_TEMPLATE_ID || "").trim();
  const headers = {
    "X-Auth-Token": cfg.apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const base = (cfg.url || FALLBACK_URL).replace(/\/$/, "");

  let res: Response;
  if (opts.pdfBytes && opts.pdfBytes.byteLength > 0) {
    const b64 = Buffer.from(opts.pdfBytes).toString("base64");
    res = await fetch(`${base}/submissions/pdf`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: opts.title,
        send_email: false,
        documents: [{ name: opts.pdfName || "order.pdf", file: b64 }],
        submitters: [
          {
            role: "Inspector",
            email: opts.inspectorEmail,
            name: opts.inspectorName,
          },
        ],
      }),
    });
  } else if (templateId) {
    res = await fetch(`${base}/submissions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        template_id: Number(templateId) || templateId,
        send_email: false,
        submitters: [
          {
            role: "Inspector",
            email: opts.inspectorEmail,
            name: opts.inspectorName,
          },
        ],
      }),
    });
  } else {
    return null;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`DocuSeal ${res.status}: ${err.slice(0, 240)}`);
  }
  const json = (await res.json()) as any;
  const row = Array.isArray(json) ? json[0] : json;
  const submitter = Array.isArray(row?.submitters) ? row.submitters[0] : row;
  return {
    id: row?.id ?? submitter?.submission_id ?? submitter?.id,
    embedSrc: submitter?.embed_src || submitter?.embed_url || row?.embed_src || null,
    slug: row?.slug,
  };
}
