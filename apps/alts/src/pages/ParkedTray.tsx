import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import "@alts/styles/alts-pos.css";

type Parked = {
  id?: string;
  name?: string;
  label?: string;
  customer_label?: string;
  customer_ref?: string | null;
  customer_snapshot?: any;
  location?: string;
  garment_count?: number;
  line_count?: number;
  total?: number;
  modified?: string;
  creation?: string;
  updated_at?: string;
  cart?: any;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function ParkedTray() {
  const nav = useNavigate();
  const qc = useQueryClient();

  const carts = useQuery({
    queryKey: ["parked-carts"],
    queryFn: async () => {
      const rows = await api.get<Parked[]>("/api/carts");
      return rows ?? [];
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/carts/${id}`),
    onSuccess: () => {
      toast.success("Parked cart removed");
      qc.invalidateQueries({ queryKey: ["parked-carts"] });
    },
    onError: () => toast.error("Could not delete"),
  });

  const commit = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ticketName?: string; name?: string; ticket?: string }>(`/api/carts/${id}/commit`, {}),
    onSuccess: (res) => {
      const name = res?.ticketName || res?.ticket || res?.name;
      toast.success(name ? `Submitted ${name}` : "Submitted");
      qc.invalidateQueries({ queryKey: ["parked-carts"] });
      if (name) nav(`/orders/alterations/${name}`);
    },
    onError: (e: Error) => toast.error(e.message || "Commit failed"),
  });

  const list = carts.data ?? [];

  return (
    <div className="alts-root min-h-screen flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <Link to="/" className="seal">
          LS
        </Link>
        <div>
          <div className="display text-xl">Parked</div>
          <div className="caps">Hold until resume or drop</div>
        </div>
        <div className="flex-1" />
        <Link to="/intake/alterations" className="btn-brass h-11 px-5 text-[11px] inline-flex items-center">
          New ticket
        </Link>
      </header>

      <div className="p-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => {
          const id = c.id || c.name || "";
          const intake = c.cart?.intake;
          const total = Number(c.total) || Number(intake?.total) || Number(c.cart?.total) || 0;
          const label = c.label || intake?.parkLabel || c.customer_label || "Parked cart";
          const gCount = intake?.garments?.length ?? c.garment_count ?? c.cart?.garments?.length ?? 0;
          const expected = intake?.expectedGarmentCount ?? gCount;
          const lines = intake?.garments
            ? intake.garments.reduce((s: number, g: any) => s + (g.lines?.length || 0), 0)
            : c.line_count ?? c.cart?.lines?.length ?? "—";
          const when = c.updated_at || c.modified || c.creation;

          return (
            <div key={id} className="card-glass p-5 flex flex-col">
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-lg leading-snug">{label}</div>
                  <div className="text-xs text-cream-dim mt-1">
                    {c.location || "NYC"}
                    {when ? ` · ${new Date(when).toLocaleString()}` : ""}
                  </div>
                </div>
                <div className="ml-auto display text-2xl text-brass-light shrink-0">{money(total)}</div>
              </div>
              <div className="flex flex-wrap gap-3 mt-3 text-xs text-cream-dim">
                <span>
                  {gCount}
                  {expected > gCount ? ` of ${expected}` : ""} garments
                </span>
                <span>{lines} lines</span>
                {intake?.parkNote ? <span className="w-full text-cream-muted mt-1">{intake.parkNote}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => nav(`/intake/alterations?parked=${encodeURIComponent(id)}`)}
                  className="btn-brass flex-1 h-11 text-[11px]"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => commit.mutate(id)}
                  disabled={commit.isPending}
                  className="btn-ghost flex-1 h-11 text-[11px]"
                >
                  Submit ticket
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Remove this parked cart?")) del.mutate(id);
                  }}
                  className="btn-ghost h-11 px-4 text-[11px]"
                >
                  Drop
                </button>
              </div>
            </div>
          );
        })}
        {carts.isLoading && <p className="text-cream-dim">Loading…</p>}
        {!carts.isLoading && !list.length && (
          <div className="md:col-span-2 card-glass p-10 text-center">
            <div className="display text-3xl mb-2">Nothing parked</div>
            <p className="text-cream-dim text-sm mb-4">
              Park holds a cart with no ticket number. Come back whenever — resume it, submit it, or drop it.
            </p>
            <Link to="/intake/alterations" className="btn-brass inline-flex h-12 px-6 items-center text-[11px]">
              Start intake
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
