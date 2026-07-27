import { Crown } from "lucide-react";
import { GlassCard } from "@ls/design";
import { formatUSD } from "@ls/design/format";

interface Customer { name: string; orders: number; revenue: number }
interface Props { data: Customer[] }

export function TopCustomers({ data }: Props) {
  if (!data?.length) return null;
  const maxRev = Math.max(...data.map(d => d.revenue), 1);

  return (
    <GlassCard variant="strong" className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="ui-label flex items-center gap-2">
          <Crown className="h-3.5 w-3.5 text-brass-light" />
          Top Customers
        </div>
        <span className="text-[10px] text-cream-dim uppercase tracking-widest">By revenue</span>
      </div>

      <div className="space-y-2">
        {data.slice(0, 8).map((c, i) => {
          const pct = Math.round((c.revenue / maxRev) * 100);
          const tier = i === 0 ? "text-brass-light" : i < 3 ? "text-cream" : "text-cream-muted";
          return (
            <div key={c.name} className="group flex items-center gap-3 py-1.5">
              <span className={`text-[10px] font-bold w-4 text-right shrink-0 ${tier}`}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs leading-tight truncate ${tier}`}>{c.name}</span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] text-cream-dim">{c.orders}×</span>
                    <span className="text-xs font-semibold text-brass-light">{formatUSD(c.revenue, { compact: true })}</span>
                  </div>
                </div>
                <div className="h-1 rounded-full bg-brass/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${pct}%`,
                      background: i === 0
                        ? "linear-gradient(90deg, #D4B27A88, #D4B27A)"
                        : "linear-gradient(90deg, #B08D5744, #B08D57)",
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
