import { cn } from "@ls/design/utils";

export type ParkDrawerProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  onLabelChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  expectedGarments: number;
  onExpectedChange: (n: number) => void;
  remind: "eod" | "3d" | "2w" | "never";
  onRemindChange: (v: "eod" | "3d" | "2w" | "never") => void;
  garments: Array<{
    ref: string;
    garmentType: string;
    color?: string;
    lines: Array<{ description: string; price: number }>;
  }>;
  total: number;
  customerName: string;
  parking: boolean;
  onPark: () => void;
  onSubmitAnyway: () => void;
  submitting?: boolean;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const CHIPS = ["waiting on pieces", "quote only", "back this afternoon", "needs C to price"] as const;

export default function ParkDrawer({
  open,
  onClose,
  label,
  onLabelChange,
  note,
  onNoteChange,
  expectedGarments,
  onExpectedChange,
  remind,
  onRemindChange,
  garments,
  total,
  customerName,
  parking,
  onPark,
  onSubmitAnyway,
  submitting,
}: ParkDrawerProps) {
  if (!open) return null;

  const lineCount = garments.reduce((s, g) => s + g.lines.length, 0);
  const inHand = garments.length;
  const expected = Math.max(expectedGarments, inHand);
  const labelOk = label.trim().length >= 3;

  const applyChip = (chip: string) => {
    const base = customerName ? `${customerName} — ` : "";
    if (!label.trim()) onLabelChange(`${base}${chip}`);
    else if (!label.toLowerCase().includes(chip.toLowerCase())) onLabelChange(`${label.trim()} · ${chip}`);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-[rgba(4,10,6,0.72)] backdrop-blur-[7px]" aria-label="Close" onClick={onClose} />
      <div
        className="relative w-full max-w-[1280px] max-h-[97vh] overflow-y-auto rounded-t-[26px] border border-brass/35 border-b-0 shadow-[var(--sl)]"
        style={{ background: "linear-gradient(170deg,#16301E,#0E1D12)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-[52px] h-1 rounded-full bg-brass/40 mx-auto mt-1.5 mb-3" />
        <div className="px-6 md:px-[30px] pb-5">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-[46px] h-[46px] rounded-[14px] grid place-items-center bg-[rgba(232,168,92,0.14)] border border-[rgba(232,168,92,0.44)] text-[var(--am)] shrink-0">
              <svg width="27" height="27" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="6" width="20" height="18" rx="2.5" />
                <path d="M9 6V3.5h10V6" />
                <path d="M14 11v7M10.5 14.5L14 18l3.5-3.5" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="display text-[27px] leading-tight">Park this ticket</h1>
              <p className="text-[11.5px] text-[var(--cd)] mt-1.5 leading-relaxed">
                Saves everything keyed so far. <b className="text-[var(--cm)] font-semibold">Nothing is written to the ticket series</b> — no number is burned, no invoice created. Pull it back from the Parked tray any time.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-[1.25fr_1fr] gap-4">
            <div className="space-y-3">
              <div className="card-glass overflow-hidden">
                <div className="flex items-center gap-2.5 px-[17px] py-3 border-b border-brass/15 bg-black/20">
                  <h3 className="display text-[17px] flex-1">Name it so you can find it</h3>
                  <span className="text-[8.5px] font-bold tracking-widest uppercase text-[var(--am)]">Required</span>
                </div>
                <div className="p-4 space-y-3">
                  <label className="block">
                    <span className="caps block mb-1.5">Label</span>
                    <input
                      value={label}
                      onChange={(e) => onLabelChange(e.target.value)}
                      placeholder={customerName ? `${customerName} — what’s waiting` : "e.g. Marcus — vest still coming"}
                      className="w-full h-[58px] rounded-[13px] bg-black/35 border border-brass/30 px-4 text-base text-cream outline-none focus:border-[var(--am)] focus:shadow-[0_0_0_3px_rgba(232,168,92,0.14)]"
                      autoFocus
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CHIPS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => applyChip(c)}
                        className="px-3.5 py-2 rounded-[10px] bg-black/30 border border-brass/25 text-[11px] font-semibold text-[var(--cm)] hover:bg-[rgba(232,168,92,0.14)] hover:border-[rgba(232,168,92,0.44)] hover:text-cream"
                      >
                        + {c}
                      </button>
                    ))}
                  </div>
                  {!labelOk && (
                    <div className="flex gap-2.5 p-3 rounded-xl bg-[rgba(217,123,108,0.1)] border border-[rgba(217,123,108,0.38)] text-[10.5px] leading-relaxed text-[var(--cm)]">
                      <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="var(--ro)" strokeWidth="1.7" className="shrink-0 mt-0.5">
                        <path d="M9 1.5l7.5 13H1.5z" />
                        <path d="M9 6.5v4M9 12.8v.2" />
                      </svg>
                      <span>
                        Two carts from <b className="text-cream">26 June</b> are still parked as “Walk-in” and nobody knows what they were. Say what you’re waiting on.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="card-glass overflow-hidden">
                <div className="flex items-center gap-2.5 px-[17px] py-3 border-b border-brass/15 bg-black/20">
                  <h3 className="display text-[17px]">What gets saved</h3>
                </div>
                {garments.length === 0 && (
                  <div className="px-[17px] py-4 text-sm text-[var(--cd)]">No garments yet — customer + notes still park.</div>
                )}
                {garments.map((g) => (
                  <div key={g.ref} className="flex items-center gap-3 px-[17px] py-2.5 border-b border-brass/10 text-[12.5px] text-[var(--cm)]">
                    <div className="flex-1 min-w-0">
                      <b className="block text-[13px] font-semibold text-cream mb-0.5">
                        {g.garmentType}
                        {g.color ? ` — ${g.color}` : ""}
                      </b>
                      <i className="not-italic text-[10.5px] text-[var(--cd)]">
                        {g.lines.map((l) => l.description).join(" · ") || "No lines yet"}
                      </i>
                    </div>
                    <div className="display text-[17px] text-[var(--cm)] shrink-0">
                      {money(g.lines.reduce((s, l) => s + (Number(l.price) || 0), 0))}
                    </div>
                  </div>
                ))}
                <div className="flex items-baseline justify-between px-[17px] py-3.5 bg-black/25 border-t border-brass/15">
                  <span className="text-[9.5px] font-bold tracking-widest uppercase text-[var(--cd)]">
                    Held so far · {inHand} garments, {lineCount} lines
                  </span>
                  <b className="display text-[30px]">{money(total)}</b>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-[15px] p-4 bg-[rgba(232,168,92,0.09)] border border-[rgba(232,168,92,0.38)]">
                <div className="flex items-center gap-2.5 mb-2.5">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--am)" strokeWidth="1.7" strokeLinecap="round">
                    <circle cx="10" cy="10" r="8" />
                    <path d="M10 5.5V10l3 2" />
                  </svg>
                  <b className="text-[12.5px] font-semibold">Still to come</b>
                </div>
                <p className="text-[11px] text-[var(--cm)] leading-relaxed">
                  Note expected pieces so the tray shows <b className="text-cream">{inHand} of {expected} garments</b> instead of looking finished.
                </p>
                <div className="flex items-center gap-2.5 mt-3">
                  <span className="flex-1 text-[10px] font-bold tracking-widest uppercase text-[var(--cd)]">Garments expected</span>
                  <div className="flex overflow-hidden rounded-[11px] border border-[rgba(232,168,92,0.44)]">
                    <button
                      type="button"
                      className="w-11 h-11 bg-black/30 text-[var(--am)] text-lg"
                      onClick={() => onExpectedChange(Math.max(inHand, expected - 1))}
                    >
                      −
                    </button>
                    <div className="w-[52px] h-11 grid place-items-center bg-[rgba(232,168,92,0.14)] display text-[22px]">{expected}</div>
                    <button type="button" className="w-11 h-11 bg-black/30 text-[var(--am)] text-lg" onClick={() => onExpectedChange(expected + 1)}>
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-[15px] p-4 bg-black/30 border border-brass/25">
                <div className="caps mb-2.5">Flag in the tray after</div>
                <div className="flex gap-1 p-1 rounded-xl bg-black/30 border border-brass/20">
                  {(
                    [
                      ["eod", "End of day", ""],
                      ["3d", "3 days", "default"],
                      ["2w", "2 weeks", ""],
                      ["never", "Never", ""],
                    ] as const
                  ).map(([k, lab, hint]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => onRemindChange(k)}
                      className={cn(
                        "flex-1 min-h-[50px] rounded-[9px] text-[10px] font-bold tracking-wide uppercase flex flex-col items-center justify-center gap-0.5",
                        remind === k ? "bg-[var(--am)] text-[#1C1204]" : "text-[var(--cd)]",
                      )}
                    >
                      {lab}
                      {hint ? <i className="not-italic text-[8.5px] font-semibold opacity-70 normal-case">{hint}</i> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="card-glass overflow-hidden">
                <div className="flex items-center gap-2.5 px-[17px] py-3 border-b border-brass/15 bg-black/20">
                  <h3 className="display text-[17px]">Note for whoever picks this up</h3>
                </div>
                <div className="p-4">
                  <textarea
                    value={note}
                    onChange={(e) => onNoteChange(e.target.value)}
                    rows={3}
                    placeholder="e.g. Vest coming this afternoon — do not submit until all pieces are in."
                    className="w-full min-h-[66px] rounded-[13px] bg-black/35 border border-brass/30 px-4 py-3 text-[13px] text-cream outline-none resize-none focus:border-[var(--am)]"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 min-h-[74px] text-[13.5px]">
              Keep editing
            </button>
            <button
              type="button"
              disabled={!labelOk || parking}
              onClick={onPark}
              className="flex-1 min-h-[74px] rounded-[17px] font-bold tracking-[0.12em] uppercase text-[13.5px] disabled:opacity-40 flex flex-col items-center justify-center gap-1"
              style={{
                background: "linear-gradient(135deg,#EFB96E,#C08E43)",
                color: "#1C1204",
                boxShadow: "0 12px 30px rgba(232,168,92,.28), inset 0 1px 0 rgba(255,255,255,.3)",
              }}
            >
              {parking ? "Parking…" : "Park ticket"}
              <i className="not-italic text-[9px] tracking-widest opacity-75 font-semibold">
                {inHand} of {expected} garments · flags {remind === "eod" ? "EOD" : remind === "3d" ? "in 3 days" : remind === "2w" ? "in 2 weeks" : "never"}
              </i>
            </button>
            <button
              type="button"
              disabled={submitting || garments.length === 0}
              onClick={onSubmitAnyway}
              className="flex-1 min-h-[74px] rounded-[17px] font-bold tracking-[0.12em] uppercase text-[13.5px] disabled:opacity-40 flex flex-col items-center justify-center gap-1"
              style={{
                background: "linear-gradient(135deg,#C79A5E,#9B7B45)",
                color: "#1A1005",
                boxShadow: "0 12px 30px rgba(176,141,87,.3), inset 0 1px 0 rgba(255,255,255,.28)",
              }}
            >
              {submitting ? "Writing…" : "Submit now anyway"}
              <i className="not-italic text-[9px] tracking-widest opacity-75 font-semibold">Creates ticket · burns a number</i>
            </button>
          </div>

          <div className="mt-3 p-3 rounded-xl bg-brass/[0.07] border border-brass/20 text-[10px] leading-relaxed text-[var(--cm)]">
            <b className="block text-[9px] font-bold tracking-widest uppercase text-brass-light mb-1.5">What parking writes</b>
            One <code className="text-brass-light font-mono text-[9px]">LSH Parked Cart</code> holding cart JSON —{" "}
            <b className="text-cream">no Alteration Ticket, no ticket number, no Sales Invoice</b>.
          </div>
        </div>
      </div>
    </div>
  );
}
