import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

type Parked = {
  id?: string;
  name?: string;
  label?: string;
  customer_label?: string;
  location?: string;
  garment_count?: number;
  line_count?: number;
  total?: number;
  modified?: string;
  creation?: string;
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
    mutationFn: (id: string) => api.post<{ ticketName?: string; name?: string }>(`/api/carts/${id}/commit`, {}),
    onSuccess: (res) => {
      const name = res?.ticketName || res?.name;
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
          <div className="caps">Resume · quote · submit</div>
        </div>
        <div className="flex-1" />
        <Link to="/intake/alterations" className="btn-brass h-11 px-5 text-[11px] inline-flex items-center">
          New ticket
        </Link>
      </header>

      <div className="p-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => {
          const id = c.id || c.name || "";
          const total = Number(c.total) || Number(c.cart?.total) || 0;
          return (
            <div key={id} className="card-glass p-5 flex flex-col">
              <div className="flex items-start gap-2">
                <div>
                  <div className="font-semibold text-lg">{c.label || c.customer_label || "Parked cart"}</div>
                  <div className="text-xs text-cream-dim mt-1">
                    {c.location || "NYC"}
                    {c.modified || c.creation
                      ? ` · ${new Date(c.modified || c.creation || "").toLocaleString()}`
                      : ""}
                  </div>
                </div>
                <div className="ml-auto display text-2xl text-brass-light">{money(total)}</div>
              </div>
              <div className="flex gap-3 mt-3 text-xs text-cream-dim">
                <span>{c.garment_count ?? c.cart?.garments?.length ?? "—"} garments</span>
                <span>{c.line_count ?? "—"} lines</span>
              </div>
              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => commit.mutate(id)}
                  disabled={commit.isPending}
                  className="btn-brass flex-1 h-11 text-[11px]"
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
              Mid-intake, hit Park to save multi-piece waves or finish later.
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
