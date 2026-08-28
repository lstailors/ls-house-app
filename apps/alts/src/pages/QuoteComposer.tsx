import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { localFirstRow, localFirstTickets } from "@alts/offline/localFirst";
import { cn } from "@ls/design/utils";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import { formatMoney } from "@alts/lib/money";

type Ticket = {
  name: string;
  customer_name?: string;
  customer_mobile?: string;
  customer_phone?: string;
  customer_email?: string;
  ticket_total?: number;
  garments?: Array<{ garment_id?: string; garment_type?: string; color?: string; garment_total?: number }>;
  lines?: Array<{ description?: string; price?: number; garment_ref?: string }>;
  due_date?: string;
};

function money(n?: number | string | null) {
  return formatMoney(n);
}

export default function QuoteComposer() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const ticketParam = params.get("ticket");
  const [ticketId, setTicketId] = useState(ticketParam || "");
  const [q, setQ] = useState("");
  const [validDays, setValidDays] = useState(7);
  const [note, setNote] = useState("Happy to adjust anything before we start.");

  const open = useQuery({
    queryKey: ["quote-open-tickets"],
    queryFn: () =>
      localFirstTickets(() => api.get<Ticket[]>("/api/intake-alterations/tickets?limit=500")),
  });

  const detail = useQuery({
    queryKey: ["quote-ticket", ticketId],
    enabled: !!ticketId,
    queryFn: () =>
      localFirstRow("tickets", ticketId, () =>
        api.get<Ticket>(`/api/intake-alterations/tickets/${ticketId}`),
      ),
  });

  const t = detail.data;
  const total = Number(t?.ticket_total) || 0;
  const phone = t?.customer_mobile || t?.customer_phone || "";
  const email = t?.customer_email || "";

  const filtered = useMemo(() => {
    let rows = open.data ?? [];
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(
        (r) => r.name?.toLowerCase().includes(s) || r.customer_name?.toLowerCase().includes(s),
      );
    }
    return rows.slice(0, 20);
  }, [open.data, q]);

  const smsBody = t
    ? `Hi ${t.customer_name?.split(" ")[0] || "there"} — your L&S alteration quote is ${money(total)} (no tax). Valid ${validDays} days. Reply YES to accept, or call the shop. ${note}`
    : "";

  const sendSms = useMutation({
    mutationFn: async () => {
      if (!ticketId) throw new Error("Pick a ticket");
      // Prefer ticket SMS endpoint; body as note if supported
      return api.post(`/api/intake-alterations/tickets/${ticketId}/sms`, {
        template: "quote",
        body: smsBody,
        message: smsBody,
      });
    },
    onSuccess: () => toast.success("Quote SMS sent via Sofia path"),
    onError: (e: Error) => {
      // Do NOT fall back to notify-ready — that texts "your order is ready".
      toast.error(e?.message || "Quote SMS failed — check quote template on API");
    },
  });

  const sendEmail = useMutation({
    mutationFn: () =>
      api.post(`/api/intake-alterations/tickets/${ticketId}/email`, {
        template: "quote",
        note,
        validDays,
      }),
    onSuccess: () => toast.success("Quote email queued"),
    onError: (e: Error) => toast.error(e.message || "Email failed — check template on API"),
  });

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <BrandSeal />
        <div>
          <div className="display text-xl">Quote</div>
          <div className="caps">Email + SMS · accept to proceed</div>
        </div>
        <div className="flex-1" />
        <Link to="/intake/kind" className="btn-ghost h-11 px-4 text-[12px] inline-flex items-center">
          New ticket
        </Link>
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_400px] min-h-0 phone-stack">
        <main className="overflow-y-auto p-5 space-y-5">
          <div>
            <h2 className="display text-3xl">Send an alteration quote</h2>
            <p className="text-sm text-cream-dim mt-1">
              Pull a ticket (or draft from intake), preview branded email + SMS, then send. Client accepts before we start
              work when deposit/quote lane is used.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find ticket or client…"
              className="flex-1 h-12 rounded-xl bg-black/30 border border-brass/25 px-4 text-cream outline-none focus:border-brass"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto">
            {open.isError && (
              <div className="sm:col-span-2">
                <QueryErrorPanel
                  compact
                  title="Could not load tickets for quote"
                  onRetry={() => open.refetch()}
                />
              </div>
            )}
            {filtered.map((row) => (
              <button
                key={row.name}
                type="button"
                onClick={() => setTicketId(row.name)}
                className={cn(
                  "quote-pick text-left card-glass p-3",
                  ticketId === row.name && "is-on border-brass ring-1 ring-brass/40",
                )}
              >
                <div className="font-mono text-[12px] text-brass-light">{row.name}</div>
                <div className="font-semibold">{row.customer_name}</div>
                <div className="text-xs text-brass-light mt-0.5">{money(Number(row.ticket_total) || 0)}</div>
              </button>
            ))}
          </div>

          {t && (
            <div className="quote-panel card-glass overflow-hidden">
              <div className="px-4 py-3 border-b border-brass/15 bg-black/20">
                <h3 className="display text-lg">Email preview</h3>
              </div>
              <div className="bg-[#FBF7EE] text-[#163524]">
                <div className="bg-[#163524] text-center px-6 py-7">
                  <div className="w-12 h-12 rounded-full border border-[#B08D57] mx-auto mb-2 grid place-items-center display text-[#D4B27A] text-xl">
                    LS
                  </div>
                  <div className="display text-[#F1E9D6] text-2xl">L&S Custom Tailors</div>
                </div>
                <div className="px-7 py-6">
                  <h2 className="display text-[27px] mb-3">Your alteration quote</h2>
                  <p className="text-[13.5px] leading-relaxed text-[#3D4A40] mb-4">
                    Dear {t.customer_name?.split(" ")[0] || "Client"},
                    <br />
                    Here’s what we propose for your pieces. No tax on alterations.
                  </p>
                  <div className="border-t border-[rgba(31,58,46,0.16)] pt-3 space-y-3">
                    {(t.garments ?? []).map((g, i) => (
                      <div key={i} className="border-b border-[rgba(31,58,46,0.1)] pb-2">
                        <div className="display text-lg">
                          {g.garment_type}
                          {g.color ? ` · ${g.color}` : ""}
                        </div>
                        <div className="flex justify-between text-sm mt-1">
                          <span className="text-[#4A574C]">Garment total</span>
                          <span className="font-semibold">{money(Number(g.garment_total) || 0)}</span>
                        </div>
                      </div>
                    ))}
                    {(t.lines ?? []).slice(0, 8).map((l, i) => (
                      <div key={i} className="flex justify-between text-[12.5px] text-[#4A574C]">
                        <span>{l.description}</span>
                        <span className="font-semibold text-[#163524]">{money(Number(l.price) || 0)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-baseline pt-4">
                    <span className="text-[12px] font-bold tracking-widest uppercase text-[#6B7A6D]">Quote total</span>
                    <span className="display text-4xl">{money(total)}</span>
                  </div>
                  <p className="text-[12px] text-[#7C8A7E] mb-4">No tax · valid {validDays} days</p>
                  <div className="rounded-xl bg-gradient-to-br from-[#C79A5E] to-[#9B7B45] text-[#1A1005] text-center py-4 text-[12px] font-bold tracking-widest uppercase mb-2">
                    Accept quote
                  </div>
                  <p className="text-[12.5px] text-[#3D4A40] mt-4">{note}</p>
                </div>
              </div>
            </div>
          )}
        </main>

        <aside className="border-l border-brass/15 bg-black/25 p-5 overflow-y-auto space-y-4">
          <div className="caps">SMS preview</div>
          <div className="quote-sms card-glass p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-full border border-brass/40 grid place-items-center display text-brass-light">
                S
              </span>
              <div>
                <div className="text-sm font-semibold">Sofia · L&S</div>
                <div className="text-[12px] text-cream-dim">{phone || "no mobile on file"}</div>
              </div>
            </div>
            <div className="rounded-2xl rounded-bl-sm border border-brass/25 bg-gradient-to-br from-[#24422F] to-[#1B3324] p-3.5 text-[13px] leading-relaxed">
              {smsBody || "Select a ticket to preview SMS."}
            </div>
          </div>

          <label className="block">
            <span className="caps">Valid days</span>
            <input
              type="number"
              min={1}
              max={30}
              value={validDays}
              onChange={(e) => setValidDays(Number(e.target.value) || 7)}
              className="mt-1.5 w-full h-11 rounded-xl bg-black/35 border border-brass/25 px-3 text-cream"
            />
          </label>
          <label className="block">
            <span className="caps">Personal note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-xl bg-black/35 border border-brass/25 px-3 py-2 text-sm text-cream resize-none"
            />
          </label>

          <button
            type="button"
            disabled={!ticketId || sendSms.isPending}
            onClick={() => sendSms.mutate()}
            className="btn-brass w-full h-14 text-[12px] disabled:opacity-40"
          >
            {sendSms.isPending ? "…" : "Send quote SMS"}
          </button>
          <button
            type="button"
            disabled={!ticketId || sendEmail.isPending}
            onClick={() => sendEmail.mutate()}
            className="btn-ghost w-full h-12 text-[12px] disabled:opacity-40"
          >
            {sendEmail.isPending ? "…" : email ? `Email · ${email}` : "Send quote email"}
          </button>
          {ticketId && (
            <button
              type="button"
              onClick={() => nav(`/orders/alterations/${ticketId}`)}
              className="w-full text-[12px] font-bold tracking-widest uppercase text-brass-light pt-2"
            >
              Open ticket →
            </button>
          )}
          <p className="text-[12px] text-cream-dim leading-relaxed">
            Decision lock: quote = email + SMS + accept. Full accept-link deep wiring ships with API quote template
            deploy.
          </p>
        </aside>
      </div>
    </div>
  );
}
