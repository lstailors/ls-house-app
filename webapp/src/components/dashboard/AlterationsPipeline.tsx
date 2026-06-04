import { useNavigate } from "react-router-dom";
import { Clock, Zap, CheckCircle2, ArrowRight, Inbox } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

const ChartTip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-forest-raised/95 backdrop-blur-sm border border-brass/30 rounded-xl px-3 py-2 text-xs text-cream shadow-glass">
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.payload.fill }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

interface Props {
  altByStatus: { received: number; inProgress: number; ready: number };
  altOverdue: number;
  altRush: number;
}

export function AlterationsPipeline({ altByStatus, altOverdue, altRush }: Props) {
  const navigate = useNavigate();

  const stages = [
    { key: "received", label: "Received", count: altByStatus.received, color: "#60a5fa", icon: Inbox },
    { key: "inProgress", label: "In Progress", count: altByStatus.inProgress, color: "#f59e0b", icon: Zap },
    { key: "ready", label: "Ready", count: altByStatus.ready, color: "#34d399", icon: CheckCircle2 },
  ];

  const total = stages.reduce((s, st) => s + st.count, 0);
  const donutData = stages.filter(s => s.count > 0).map(s => ({ name: s.label, value: s.count, fill: s.color }));

  return (
    <GlassCard variant="strong" className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="ui-label">Alterations Pipeline</div>
        <button
          onClick={() => navigate("/orders/alterations")}
          className="text-xs text-brass-light hover:text-brass transition-colors"
        >
          View all →
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
        {/* Donut + total */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name"
                  innerRadius={42} outerRadius={62} paddingAngle={3} startAngle={90} endAngle={-270}>
                  {donutData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="kpi-number text-3xl leading-none">{total}</span>
              <span className="text-[10px] text-cream-muted uppercase tracking-wider">open</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
            {stages.map(s => (
              <div key={s.key} className="flex items-center gap-1 text-[10px] text-cream-muted">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: s.color }} />
                {s.label}
              </div>
            ))}
          </div>
        </div>

        {/* Stage bars */}
        <div className="space-y-3">
          {stages.map((s) => {
            const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
            const Icon = s.icon;
            return (
              <div key={s.key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-xs text-cream">
                    <Icon className="h-3 w-3 shrink-0" style={{ color: s.color }} />
                    {s.label}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: s.color }}>{s.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-forest-highlight/60 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: s.color + "99" }} />
                </div>
              </div>
            );
          })}

          {/* Alert row */}
          <div className="pt-2 border-t border-brass/10 flex gap-3 flex-wrap">
            {altOverdue > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-900/20 border border-red-500/25 text-xs text-red-400">
                <Clock className="h-3 w-3" />
                {altOverdue} overdue
              </div>
            ) : null}
            {altRush > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-signal-amber/10 border border-signal-amber/25 text-xs text-signal-amber">
                <Zap className="h-3 w-3" />
                {altRush} rush
              </div>
            ) : null}
            {altOverdue === 0 && altRush === 0 ? (
              <span className="text-[11px] text-cream-muted/60 italic">All on track</span>
            ) : null}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
