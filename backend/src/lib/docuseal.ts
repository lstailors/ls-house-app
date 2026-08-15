/** DocuSeal signing — optional. If unset, the phone uses an on-device signature pad. */

import { loadDocusealSettings } from "./qc-settings";

const FALLBACK_URL = "https://docuseal.lstailors.com";
const SIGNER_ROLE = "Inspector";

export function docusealApiBase(url: string): string {
  const raw = (url || FALLBACK_URL).trim().replace(/\/$/, "");
  if (!raw) return `${FALLBACK_URL}/api`;
  if (/\/api$/i.test(raw)) return raw;
  if (/^https?:\/\/api\.docuseal\.com$/i.test(raw)) return raw;
  return `${raw}/api`;
}

export function docusealPublicBase(url: string): string {
  const raw = (url || FALLBACK_URL).trim().replace(/\/$/, "");
  return raw.replace(/\/api$/i, "") || FALLBACK_URL;
}

export async function docusealEnabled() {
  const s = await loadDocusealSettings();
  return Boolean(s.apiKey);
}

export type DocuSealSubmission = {
  id: string | number;
  embedSrc: string | null;
  slug?: string;
};

function headers(apiKey: string) {
  return {
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function pingDocuseal(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadDocusealSettings();
  if (!cfg.apiKey) return { ok: false, message: "No API key saved" };
  const base = docusealApiBase(cfg.url);
  try {
    const res = await fetch(`${base}/templates?limit=1`, {
      headers: headers(cfg.apiKey),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, message: "DocuSeal answered" };
    const err = await res.text().catch(() => "");
    return { ok: false, message: `DocuSeal ${res.status}: ${err.slice(0, 160) || res.statusText}` };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Could not reach DocuSeal" };
  }
}

function parseSubmission(json: unknown, publicBase: string): DocuSealSubmission {
  const row = (Array.isArray(json) ? json[0] : json) as Record<string, any> | undefined;
  const submitter = Array.isArray(row?.submitters) ? row.submitters[0] : row;
  const slug = String(submitter?.slug || row?.slug || "");
  const embedSrc =
    submitter?.embed_src ||
    submitter?.embed_url ||
    row?.embed_src ||
    (slug ? `${publicBase}/s/${slug}` : null);
  return {
    id: row?.id ?? submitter?.submission_id ?? submitter?.id,
    embedSrc: embedSrc || null,
    slug: slug || undefined,
  };
}

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
  const api = docusealApiBase(cfg.url);
  const publicBase = docusealPublicBase(cfg.url);
  const auth = headers(cfg.apiKey);
  const submitters = [
    {
      role: SIGNER_ROLE,
      email: opts.inspectorEmail,
      name: opts.inspectorName,
      send_email: false,
    },
  ];

  let res: Response;
  if (opts.pdfBytes && opts.pdfBytes.byteLength > 0) {
    const b64 = Buffer.from(opts.pdfBytes).toString("base64");
    res = await fetch(`${api}/submissions/pdf`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: opts.title,
        send_email: false,
        documents: [
          {
            name: opts.pdfName || "order.pdf",
            file: b64,
            fields: [
              {
                name: "Signature",
                type: "signature",
                role: SIGNER_ROLE,
                required: true,
                title: "QC sign-off",
                areas: [{ x: 52, y: 86, w: 42, h: 10, page: 1 }],
              },
            ],
          },
        ],
        submitters,
      }),
    });
  } else if (templateId) {
    res = await fetch(`${api}/submissions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        template_id: Number(templateId) || templateId,
        send_email: false,
        submitters,
      }),
    });
  } else {
    return null;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`DocuSeal ${res.status}: ${err.slice(0, 240)}`);
  }
  return parseSubmission(await res.json(), publicBase);
}
