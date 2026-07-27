import { erpCreate, erpGet, erpUpdate } from "../erp";
import { DT } from "./doctypes";

const SENDER = "concierge@lstailors.com";

async function loadDraft(draftId: string) {
  return erpGet<Record<string, unknown>>(DT.PENDING_EMAIL_DRAFT, draftId);
}

async function sendDraftEmail(draft: Record<string, unknown>, body: string) {
  const to = String(draft.to_email ?? "").trim();
  if (!to) throw new Error("Draft has no recipient email");

  await erpCreate("Communication", {
    doctype: "Communication",
    communication_type: "Communication",
    communication_medium: "Email",
    sent_or_received: "Sent",
    subject: draft.subject ?? "Message from L&S Custom Tailors",
    content: body,
    sender: draft.inbox ?? SENDER,
    sender_full_name: "Sofia — L&S Custom Tailors",
    recipients: to,
    status: "Linked",
  });

  await erpCreate(DT.EMAIL_MESSAGE_LOG, {
    to_email: to,
    subject: draft.subject ?? "",
    body,
    status: "sent",
  }).catch(() => {});
}

export async function approveEmailDraft(
  draftId: string,
  newBody?: string,
): Promise<{ ok: boolean; error?: string }> {
  const draft = await loadDraft(draftId);
  if (!draft) return { ok: false, error: "Draft not found" };
  if (String(draft.status ?? "") !== "pending") {
    return { ok: false, error: `Draft is ${draft.status}` };
  }

  const body = newBody?.trim() ? newBody : String(draft.body ?? "");
  if (newBody?.trim()) {
    await erpUpdate(DT.PENDING_EMAIL_DRAFT, draftId, { body });
  }

  try {
    await sendDraftEmail(draft, body);
    await erpUpdate(DT.PENDING_EMAIL_DRAFT, draftId, { status: "sent" });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Send failed" };
  }
}

export async function discardEmailDraft(
  draftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const draft = await loadDraft(draftId);
  if (!draft) return { ok: false, error: "Draft not found" };
  await erpUpdate(DT.PENDING_EMAIL_DRAFT, draftId, { status: "discarded" });
  return { ok: true };
}
