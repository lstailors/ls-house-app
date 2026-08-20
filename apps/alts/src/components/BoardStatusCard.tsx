/**
 * HER-75 / SPEC 043 — "On the board" card (Lucia 033-delivery-status).
 * Read-only board mirror for alts Dispatch. POD capture stays on driver/public flow.
 */
import { Link } from "react-router-dom";
import { StatusPill } from "@ls/design";
import { cn } from "@ls/design/utils";

export type BoardDelivery = {
  id: string;
  deliveryNo?: string | null;
  status: string;
  method?: string | null;
  courierName?: string | null;
  driver?: { name?: string | null; phone?: string | null } | null;
  scheduledAt?: string | null;
  deliveredAt?: string | null;
  dispatchedAt?: string | null;
  createdAt?: string | null;
  addressLine?: string | null;
  city?: string | null;
  garmentSummary?: string | null;
  garmentCount?: number | null;
  podMethod?: string | null;
  hasSignature?: boolean;
  proofOfDeliveryUrl?: string | null;
  signatureImageUrl?: string | null;
  notes?: string | null;
  photos?: Array<{ url?: string | null }>;
};

function fmtShort(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function isFailed(status: string) {
  return status === "failed" || status === "cancelled";
}

function isInFlight(status: string) {
  return status === "out_for_delivery" || status === "ready_for_pickup";
}

type StepKind = "unreached" | "done" | "current" | "failed";

function railSteps(d: BoardDelivery): Array<{ label: string; ts: string; kind: StepKind }> {
  const failed = isFailed(d.status);
  const delivered = d.status === "delivered" || !!d.deliveredAt;
  const out = delivered || d.status === "out_for_delivery" || !!d.dispatchedAt;
  const scheduled =
    out || d.status === "scheduled" || d.status === "queued" || d.status === "ready_for_pickup" || !!d.scheduledAt;
  // Any board row exists → queued happened
  const queued = true;

  const mk = (label: string, ts: string | null | undefined, reached: boolean, current: boolean, fail = false) => ({
    label,
    ts: fmtShort(ts),
    kind: (fail ? "failed" : current ? "current" : reached ? "done" : "unreached") as StepKind,
  });

  // Current = first incomplete stage (or failed terminal)
  let currentIdx = 0;
  if (!queued) currentIdx = 0;
  else if (!scheduled) currentIdx = 1;
  else if (!out) currentIdx = 2;
  else if (!delivered && !failed) currentIdx = 3;
  else currentIdx = 3;

  if (failed) {
    return [
      mk("Queued", d.createdAt, true, false),
      mk("Scheduled", d.scheduledAt, scheduled, false),
      mk("Out for delivery", d.dispatchedAt, out, false),
      mk("Failed", d.deliveredAt ?? d.dispatchedAt, true, false, true),
    ];
  }

  return [
    mk("Queued", d.createdAt, true, currentIdx === 0 && !delivered),
    mk("Scheduled", d.scheduledAt, scheduled, currentIdx === 1 && !delivered),
    mk("Out for delivery", d.dispatchedAt, out, currentIdx === 2 && !delivered),
    mk("Delivered", d.deliveredAt, delivered, delivered ? false : currentIdx === 3),
  ].map((s, i, arr) => {
    // If fully delivered, all done
    if (delivered && i < arr.length) {
      return { ...s, kind: "done" as StepKind };
    }
    return s;
  });
}

export default function BoardStatusCard({ board }: { board: BoardDelivery }) {
  const steps = railSteps(board);
  const live = isInFlight(board.status);
  const failed = isFailed(board.status);
  const delivered = board.status === "delivered";
  const podUrl = board.proofOfDeliveryUrl || board.signatureImageUrl || board.photos?.[0]?.url || null;
  const hasPod = !!(board.podMethod || board.hasSignature || podUrl);
  const driver = board.courierName || board.driver?.name || null;
  const window =
    board.deliveredAt || board.dispatchedAt || board.scheduledAt
      ? fmtShort(board.deliveredAt || board.dispatchedAt || board.scheduledAt)
      : null;
  const address = [board.addressLine, board.city].filter(Boolean).join(", ") || null;
  const garments =
    board.garmentCount && board.garmentCount > 0
      ? `${board.garmentCount}${board.garmentSummary ? ` · ${board.garmentSummary}` : ""}`
      : board.garmentSummary || null;

  return (
    <div
      className="card-glass overflow-hidden mb-0"
      style={{
        borderColor: live ? "rgba(232,168,92,.38)" : failed ? "rgba(217,123,108,.35)" : "rgba(176,141,87,.2)",
      }}
    >
      <div
        className="flex items-center gap-[11px] px-[18px] py-[14px] border-b border-brass/15"
        style={{ background: "rgba(0,0,0,.2)" }}
      >
        <h3 className="display text-[18px] flex-1 m-0">On the board</h3>
        <span className="font-mono text-[12px] text-[var(--cd)]">{board.deliveryNo || board.id}</span>
        <StatusPill status={board.status} />
      </div>

      <div className="px-[18px] pt-[17px] pb-[18px]">
        {/* Progress rail */}
        <div className="flex items-start mb-1">
          {steps.map((st, i) => (
            <div key={st.label} className="flex-1 relative pt-[22px] text-center">
              {i < steps.length - 1 && (
                <span
                  className="absolute top-[6px] left-1/2 right-[-50%] h-px"
                  style={{
                    background:
                      st.kind === "done" || st.kind === "failed"
                        ? "rgba(79,191,142,.45)"
                        : "rgba(176,141,87,.2)",
                  }}
                />
              )}
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 w-[13px] h-[13px] rounded-full"
                style={{
                  background:
                    st.kind === "done"
                      ? "var(--em)"
                      : st.kind === "current"
                        ? "var(--am)"
                        : st.kind === "failed"
                          ? "var(--ro)"
                          : "var(--fd)",
                  border:
                    st.kind === "done"
                      ? "1px solid var(--em)"
                      : st.kind === "current"
                        ? "1px solid var(--am)"
                        : st.kind === "failed"
                          ? "1px solid var(--ro)"
                          : "1px solid rgba(176,141,87,.35)",
                  boxShadow:
                    st.kind === "current"
                      ? "0 0 0 4px rgba(232,168,92,.18)"
                      : st.kind === "failed"
                        ? "0 0 0 4px rgba(217,123,108,.18)"
                        : undefined,
                }}
              />
              <div
                className="text-[12px] font-semibold tracking-[0.08em] uppercase leading-snug"
                style={{
                  color:
                    st.kind === "done"
                      ? "var(--cm)"
                      : st.kind === "current"
                        ? "var(--am)"
                        : st.kind === "failed"
                          ? "var(--ro)"
                          : "var(--cd)",
                }}
              >
                {st.label}
              </div>
              <div className="text-[12px] text-[var(--cd)] mt-[3px] tabular-nums">{st.ts}</div>
            </div>
          ))}
        </div>

        {/* Meta 2×2 */}
        <div
          className="grid grid-cols-2 gap-px mt-[18px] rounded-xl overflow-hidden"
          style={{ background: "rgba(176,141,87,.14)" }}
        >
          {(
            [
              ["Driver", driver],
              ["Window", window],
              ["Address", address],
              ["Garments", garments],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="px-[14px] py-3" style={{ background: "rgba(13,26,16,.6)" }}>
              <div className="text-[12px] font-semibold tracking-[0.14em] uppercase text-[var(--cd)]">{k}</div>
              <div className={cn("text-[14px] mt-1", v ? "text-[var(--cr)]" : "text-[var(--cd)] italic")}>
                {v || "—"}
              </div>
            </div>
          ))}
        </div>

        {/* POD strip — read-only */}
        {delivered && hasPod ? (
          <div
            className="flex items-center gap-[11px] mt-[14px] px-[14px] py-3 rounded-xl"
            style={{ background: "rgba(79,191,142,.07)", border: "1px solid rgba(79,191,142,.25)" }}
          >
            <div
              className="w-[38px] h-[38px] rounded-lg grid place-items-center text-[15px] text-[var(--em)] shrink-0"
              style={{
                background: "linear-gradient(135deg,#2a4433,#16281c)",
                border: "1px solid rgba(79,191,142,.3)",
              }}
            >
              ✓
            </div>
            <div className="flex-1 min-w-0">
              <b className="block text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--em)]">
                {board.podMethod || "Proof on file"}
              </b>
              <i className="not-italic block text-[12px] text-[var(--cm)] mt-[3px]">
                {board.hasSignature || board.signatureImageUrl ? "Signature + photo" : "Photo proof"}
              </i>
            </div>
            <Link
              to={`/deliveries/${encodeURIComponent(board.id)}`}
              className="min-h-11 px-3 grid place-items-center text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--bl)]"
            >
              View
            </Link>
          </div>
        ) : failed ? (
          <div
            className="flex items-center gap-[11px] mt-[14px] px-[14px] py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(176,141,87,.18)" }}
          >
            <div
              className="w-[38px] h-[38px] rounded-lg grid place-items-center text-[15px] text-[var(--cd)] shrink-0"
              style={{ border: "1px solid rgba(176,141,87,.25)" }}
            >
              !
            </div>
            <div className="flex-1 min-w-0">
              <b className="block text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--cd)]">
                Delivery failed
              </b>
              <i className="not-italic block text-[12px] text-[var(--cm)] mt-[3px]">
                {board.notes || "Driver could not complete drop"}
              </i>
            </div>
            <Link
              to={`/deliveries/${encodeURIComponent(board.id)}`}
              className="min-h-11 px-3 grid place-items-center text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--bl)]"
            >
              Reschedule
            </Link>
          </div>
        ) : (
          <div
            className="flex items-center gap-[11px] mt-[14px] px-[14px] py-3 rounded-xl"
            style={{ background: "rgba(232,168,92,.06)", border: "1px solid rgba(232,168,92,.25)" }}
          >
            <div
              className="w-[38px] h-[38px] rounded-lg grid place-items-center text-[15px] text-[var(--am)] shrink-0"
              style={{ border: "1px solid rgba(232,168,92,.3)" }}
            >
              ◷
            </div>
            <div className="flex-1 min-w-0">
              <b className="block text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--am)]">
                Proof of delivery pending
              </b>
              <i className="not-italic block text-[12px] text-[var(--cm)] mt-[3px]">
                Capture on driver phone — never charges
              </i>
            </div>
            <a
              href={`/deliveries/${encodeURIComponent(board.id)}/pod`}
              className="min-h-11 px-3 grid place-items-center text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--bl)]"
            >
              Open POD
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
