import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Phone, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { CustomerPicker, selectionKey, type DispatchSelection } from "@/components/dispatch/CustomerPicker";
import { ThreadView, type PendingDraft } from "@/components/dispatch/ThreadView";
import { Composer } from "@/components/dispatch/Composer";
import { BatchPanel } from "@/components/dispatch/BatchPanel";
import { cn } from "@ls/design/utils";
import type { DispatchThread } from "@ls/types";

const ERP_URL = "https://erp.lstailors.com";

export default function SofiaDispatch() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<DispatchSelection | null>(null);
  const [limit, setLimit] = useState<number>(50);
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
  const [newPhone, setNewPhone] = useState<string>("");
  const [batchMode, setBatchMode] = useState<boolean>(false);
  const [batchRecipients, setBatchRecipients] = useState<DispatchSelection[]>([]);

  const batchKeys = new Set(batchRecipients.map(selectionKey));

  const toggleRecipient = (sel: DispatchSelection) => {
    const key = selectionKey(sel);
    setBatchRecipients((list) =>
      list.some((r) => selectionKey(r) === key) ? list.filter((r) => selectionKey(r) !== key) : [...list, sel],
    );
  };

  const threadKey = ["dispatch-thread", selected?.customerId ?? null, selected?.phone ?? null, limit];
  const { data: thread, isLoading: threadLoading, refetch } = useQuery({
    queryKey: threadKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (selected?.customerId) params.set("customer", selected.customerId);
      if (selected?.phone) params.set("phone", selected.phone);
      params.set("limit", String(limit));
      return api.get<DispatchThread>(`/api/dispatch/thread?${params.toString()}`);
    },
    enabled: !!selected,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const effectivePhone = thread?.phone ?? selected?.phone ?? null;
  const optedOut = thread?.optedOut ?? false;

  const invalidateThread = () => {
    qc.invalidateQueries({ queryKey: ["dispatch-thread"] });
    qc.invalidateQueries({ queryKey: ["dispatch-recent"] });
  };

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; mode: "template" | "custom" | "sofia"; template?: string }) =>
      api.post<{ ok: boolean; status: string; error: string | null }>("/api/dispatch/send", {
        customer: selected?.customerId ?? undefined,
        clientName: selected?.name,
        phone: effectivePhone,
        body: payload.body,
        mode: payload.mode,
        template: payload.template,
      }),
  });

  const composeMutation = useMutation({
    mutationFn: (instruction: string) =>
      api.post<{ draft: string }>("/api/dispatch/compose", {
        customer: selected?.customerId ?? undefined,
        customerName: selected?.name,
        phone: effectivePhone ?? undefined,
        instruction,
      }),
  });

  const phoneMutation = useMutation({
    mutationFn: (phone: string) =>
      api.post<{ ok: boolean; phone: string }>("/api/dispatch/phone", { customer: selected?.customerId, phone }),
    onSuccess: (res) => {
      toast.success(`Number saved to customer: ${res.phone}`);
      setSelected((s) => (s ? { ...s, phone: res.phone } : s));
      setNewPhone("");
      invalidateThread();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save the number."),
  });

  const doSend = async (body: string, mode: "template" | "custom" | "sofia", template?: string): Promise<boolean> => {
    try {
      const res = await sendMutation.mutateAsync({ body, mode, template });
      if (res.ok) {
        toast.success("Message sent.");
      } else {
        toast.error(res.error ? `Send failed: ${res.error}` : "Send failed — see the thread for details.");
      }
      invalidateThread();
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Send failed.");
      invalidateThread();
      return false;
    }
  };

  const doCompose = async (instruction: string): Promise<boolean> => {
    try {
      const res = await composeMutation.mutateAsync(instruction);
      setPendingDraft({ text: res.draft, editing: false });
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Sofia could not compose a draft.");
      return false;
    }
  };

  const approveDraft = async () => {
    if (!pendingDraft) return;
    const ok = await doSend(pendingDraft.text.trim(), "sofia");
    if (ok) setPendingDraft(null);
  };

  const noPhone = !!selected && !threadLoading && !effectivePhone;
  const composerDisabledReason = noPhone
    ? selected?.customerId
      ? "No phone number on file for this customer — add one below to enable sending."
      : "No phone number for this conversation."
    : null;

  return (
    <div className="space-y-6 animate-fade-up h-full flex flex-col">
      <SectionHeader
        eyebrow="L&S House · Client SMS"
        title={
          <>
            Sofia <span className="text-brass-shimmer">Dispatch</span>.
          </>
        }
        description="Pick a client, see the whole conversation, and send — a starter template, your own words, or a message Sofia composes for your approval."
        actions={
          <button
            onClick={() => {
              setBatchMode((b) => !b);
              setSelected(null);
              setPendingDraft(null);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-all",
              batchMode
                ? "border-brass/60 bg-brass/20 text-cream"
                : "border-brass/30 bg-brass/8 text-brass-shimmer hover:bg-brass/15 hover:border-brass/50",
            )}
          >
            <Users className="h-3.5 w-3.5" />
            {batchMode ? "Exit batch mode" : "Batch send"}
          </button>
        }
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px,1fr] gap-4">
        {/* Left: customer picker (hidden on mobile once a thread is open; always visible in batch mode) */}
        <div className={cn("min-h-0 lg:h-[calc(100dvh-16rem)]", !batchMode && selected ? "hidden lg:block" : "h-[calc(100dvh-16rem)]")}>
          <CustomerPicker
            selected={selected}
            batchMode={batchMode}
            batchKeys={batchKeys}
            onSelect={(sel) => {
              if (batchMode) {
                toggleRecipient(sel);
                return;
              }
              setSelected(sel);
              setPendingDraft(null);
              setLimit(50);
            }}
          />
        </div>

        {/* Right: conversation or batch panel */}
        <GlassCard className={cn("min-h-0 flex-col lg:h-[calc(100dvh-16rem)] overflow-hidden p-0", batchMode || selected ? "flex h-[calc(100dvh-14rem)]" : "hidden lg:flex")}>
          {batchMode ? (
            <BatchPanel
              recipients={batchRecipients}
              onRemove={(key) => setBatchRecipients((list) => list.filter((r) => selectionKey(r) !== key))}
              onClear={() => setBatchRecipients([])}
              onDone={() => {
                setBatchRecipients([]);
                setBatchMode(false);
                invalidateThread();
              }}
            />
          ) : !selected ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-cream-dim">Select a customer to open their conversation.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-brass/15 px-4 py-3">
                <button onClick={() => setSelected(null)} className="lg:hidden text-cream-dim hover:text-cream">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-cream truncate">{thread?.customer?.name ?? selected.name}</div>
                  <div className="text-[11px] text-cream-dim flex items-center gap-1.5">
                    <Phone className="h-3 w-3" />
                    {effectivePhone ?? "No phone on file"}
                  </div>
                </div>
                {selected.customerId ? (
                  <a
                    href={`${ERP_URL}/app/customer/${encodeURIComponent(selected.customerId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-brass-light border border-brass/25 rounded-full px-2.5 py-1 hover:bg-brass/10 transition-colors shrink-0"
                  >
                    <ExternalLink className="h-3 w-3" /> Customer
                  </a>
                ) : null}
                <button
                  onClick={() => refetch()}
                  className="text-cream-dim hover:text-cream transition-colors shrink-0"
                  title="Refresh thread"
                >
                  <RefreshCw className={cn("h-4 w-4", threadLoading ? "animate-spin" : "")} />
                </button>
              </div>

              <ThreadView
                messages={thread?.messages ?? []}
                hasMore={thread?.hasMore ?? false}
                loading={threadLoading}
                onLoadEarlier={() => setLimit((l) => Math.min(l + 100, 200))}
                pendingDraft={pendingDraft}
                onDraftChange={(text) => setPendingDraft((d) => (d ? { ...d, text } : d))}
                onDraftEditToggle={() => setPendingDraft((d) => (d ? { ...d, editing: !d.editing } : d))}
                onDraftApprove={approveDraft}
                onDraftDiscard={() => setPendingDraft(null)}
                approving={sendMutation.isPending}
              />

              {noPhone && selected.customerId ? (
                <div className="border-t border-brass/15 px-4 py-3 flex items-center gap-2">
                  <input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="Add mobile number, e.g. (917) 555-0142"
                    className="flex-1 rounded-xl border border-brass/20 bg-forest-deep/40 px-3 py-2 text-base sm:text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50"
                  />
                  <button
                    onClick={() => phoneMutation.mutate(newPhone)}
                    disabled={phoneMutation.isPending || newPhone.replace(/\D/g, "").length < 10}
                    className="rounded-full bg-brass px-4 py-2 text-xs font-semibold text-forest-deep hover:bg-brass-light transition-colors disabled:opacity-40"
                  >
                    Save number
                  </button>
                </div>
              ) : (
                <Composer
                  customerId={selected.customerId}
                  disabled={!effectivePhone || optedOut}
                  disabledReason={composerDisabledReason}
                  optedOut={optedOut}
                  sending={sendMutation.isPending}
                  composing={composeMutation.isPending}
                  onSend={(body, mode, template) => doSend(body, mode, template)}
                  onCompose={doCompose}
                />
              )}
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
