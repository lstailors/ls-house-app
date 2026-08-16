/** DocuSeal signing — optional. If unset, the phone uses an on-device signature pad. */

import { loadDocusealSettings, saveDocusealSettings } from "./qc-settings";

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

export type DocusealTemplate = {
  id: string | number;
  name?: string;
  slug?: string;
  submitters?: Array<{ name?: string; role?: string }>;
};

export function isDocusealProOnly(message: string): boolean {
  return /pro edition|available in pro/i.test(message);
}

export function pickQcTemplate(
  templates: DocusealTemplate[],
  preferredId?: string,
): DocusealTemplate | null {
  if (!templates.length) return null;
  const want = String(preferredId || "").trim();
  if (want) {
    const hit = templates.find((t) => String(t.id) === want || t.slug === want);
    if (hit) return hit;
  }
  return (
    templates.find((t) => /qc|quality|sign|inspect|lsh/i.test(String(t.name || t.slug || ""))) ||
    templates[0] ||
    null
  );
}

export function templateSignerRole(template: DocusealTemplate | null | undefined): string {
  const row = template?.submitters?.[0];
  const role = String(row?.name || row?.role || "").trim();
  return role || SIGNER_ROLE;
}

function headers(apiKey: string) {
  return {
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function asTemplates(json: unknown): DocusealTemplate[] {
  const rows = Array.isArray(json) ? json : (json as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && typeof row === "object" && "id" in (row as object)) as DocusealTemplate[];
}

async function listTemplates(api: string, auth: Record<string, string>): Promise<DocusealTemplate[]> {
  const res = await fetch(`${api}/templates?limit=50`, {
    headers: auth,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`DocuSeal ${res.status}: ${err.slice(0, 240) || res.statusText}`);
  }
  return asTemplates(await res.json());
}

async function loadTemplate(
  api: string,
  auth: Record<string, string>,
  id: string | number,
): Promise<DocusealTemplate | null> {
  const res = await fetch(`${api}/templates/${encodeURIComponent(String(id))}`, {
    headers: auth,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const row = (json as { data?: DocusealTemplate })?.data || json;
  return row && typeof row === "object" && "id" in row ? (row as DocusealTemplate) : null;
}

export async function pingDocuseal(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadDocusealSettings();
  if (!cfg.apiKey) return { ok: false, message: "No API key saved" };
  const base = docusealApiBase(cfg.url);
  try {
    const templates = await listTemplates(base, headers(cfg.apiKey));
    const picked = pickQcTemplate(templates, cfg.templateId);
    if (!templates.length) {
      return {
        ok: true,
        message: "Key works. In DocuSeal create a template with a Signature box, then tap Sign on a QC ticket.",
      };
    }
    return {
      ok: true,
      message: picked?.name
        ? `Connected. Signing uses “${picked.name}”.`
        : `Connected. ${templates.length} template${templates.length === 1 ? "" : "s"} ready.`,
    };
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
    id: submitter?.submission_id ?? row?.submission_id ?? row?.id ?? submitter?.id,
    embedSrc: embedSrc || null,
    slug: slug || undefined,
  };
}

export function parseDocusealWebhook(body: Record<string, any> | null | undefined): {
  completed: boolean;
  ids: string[];
  inspectionName: string | null;
  signedUrl: string | null;
} {
  const event = String(body?.event_type || body?.event || "").toLowerCase();
  const data = (body?.data ?? body ?? {}) as Record<string, any>;
  const submission = (data.submission ?? {}) as Record<string, any>;
  const completed =
    /complet|signed|finished|closed/.test(event) ||
    data.status === "completed" ||
    submission.status === "completed";
  const ids = [...new Set(
    [data.submission_id, submission.id, data.id, body?.submission_id]
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  )];
  const inspectionName = String(data.external_id || data.application_key || "").trim() || null;
  const signedUrl =
    data.documents?.[0]?.url ||
    submission.combined_document_url ||
    data.combined_document_url ||
    submission.audit_log_url ||
    data.audit_log_url ||
    null;
  return { completed, ids, inspectionName, signedUrl };
}

const NO_TEMPLATE =
  "DocuSeal is on, but this server cannot sign a raw PDF (that is a paid DocuSeal feature). In DocuSeal tap New Template, add a Signature box, save. Then tap Sign with DocuSeal again.";

async function resolveTemplate(
  api: string,
  auth: Record<string, string>,
  preferredId?: string,
): Promise<DocusealTemplate | null> {
  if (preferredId) {
    const direct = await loadTemplate(api, auth, preferredId);
    if (direct) return direct;
  }
  const listed = await listTemplates(api, auth);
  return pickQcTemplate(listed, preferredId);
}

export type QcDocusealField = { name: string; default_value: string };

export function qcDocusealFields(input: {
  customerName?: string | null;
  order?: string | null;
  result?: string | null;
  notes?: string | null;
  inspection?: string | null;
  checksText?: string | null;
}): QcDocusealField[] {
  const pairs: Array<[string, string]> = [
    ["Customer", String(input.customerName || "").trim()],
    ["Client", String(input.customerName || "").trim()],
    ["Order", String(input.order || "").trim()],
    ["Result", String(input.result || "").trim()],
    ["QC Result", String(input.result || "").trim()],
    ["Notes", String(input.notes || "").trim()],
    ["Checks", String(input.checksText || "").trim()],
    ["Summary", String(input.checksText || "").trim()],
    ["Inspection", String(input.inspection || "").trim()],
  ];
  const seen = new Set<string>();
  const out: QcDocusealField[] = [];
  for (const [name, value] of pairs) {
    if (!value || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, default_value: value.slice(0, 8000) });
  }
  return out;
}

export async function downloadDocusealDocuments(
  submissionId: string,
  signedUrl?: string | null,
): Promise<Array<{ bytes: Uint8Array; filename: string }>> {
  const files: Array<{ bytes: Uint8Array; filename: string }> = [];
  const push = async (url: string, filename: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 80) files.push({ bytes, filename });
    } catch {
      /* optional */
    }
  };
  if (signedUrl) await push(signedUrl, `qc-docuseal-${submissionId}.pdf`);

  const cfg = await loadDocusealSettings();
  if (!cfg.apiKey) return files;
  const api = docusealApiBase(cfg.url);
  const auth = headers(cfg.apiKey);
  try {
    const res = await fetch(`${api}/submissions/${encodeURIComponent(submissionId)}/documents`, {
      headers: auth,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return files;
    const json = await res.json();
    const rows = Array.isArray(json) ? json : (json as { data?: unknown[] })?.data || [];
    for (const [i, row] of rows.entries()) {
      const url = String((row as { url?: string })?.url || "");
      if (url) await push(url, `qc-docuseal-${submissionId}-${i + 1}.pdf`);
    }
  } catch {
    /* optional */
  }
  return files;
}

export async function createQcSignatureSubmission(opts: {
  title: string;
  inspectorEmail: string;
  inspectorName: string;
  pdfBytes?: ArrayBuffer | null;
  pdfName?: string;
  fields?: QcDocusealField[];
  externalId?: string;
}): Promise<DocuSealSubmission | null> {
  const cfg = await loadDocusealSettings();
  if (!cfg.apiKey) return null;

  const api = docusealApiBase(cfg.url);
  const publicBase = docusealPublicBase(cfg.url);
  const auth = headers(cfg.apiKey);
  const preferred = (cfg.templateId || process.env.DOCUSEAL_TEMPLATE_ID || "").trim();

  const template = await resolveTemplate(api, auth, preferred);
  if (!template) throw new Error(NO_TEMPLATE);

  const role = templateSignerRole(template);
  const res = await fetch(`${api}/submissions`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      template_id: Number(template.id) || template.id,
      send_email: false,
      name: opts.title,
      submitters: [
        {
          role,
          email: opts.inspectorEmail,
          name: opts.inspectorName,
          send_email: false,
          ...(opts.externalId ? { external_id: opts.externalId } : {}),
          ...(opts.fields?.length ? { fields: opts.fields } : {}),
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    if (isDocusealProOnly(err)) throw new Error(NO_TEMPLATE);
    throw new Error(`DocuSeal ${res.status}: ${err.slice(0, 240)}`);
  }

  if (String(template.id) !== preferred) {
    await saveDocusealSettings({ templateId: String(template.id) }).catch(() => null);
  }

  return parseSubmission(await res.json(), publicBase);
}
