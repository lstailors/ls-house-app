import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";
import { TickNumber } from "@alts/components/live/TickNumber";

export type PipelineStage = {
  key: string;
  label: string;
  count: number | null | undefined;
  to: string;
  tone?: "default" | "warn" | "hot" | "good";
};

/** Azira-style horizontal stage pipeline — Liquid Glass. */
export function StatusPipeline({
  title = "Shop pipeline",
  stages,
  pulse,
}: {
  title?: string;
  stages: PipelineStage[];
  pulse?: boolean;
}) {
  const total = stages.reduce((s, st) => s + (Number(st.count) || 0), 0) || 1;

  return (
    <section
      className={cn("live-band live-pipeline", pulse && "is-pulse")}
      data-band="pipeline"
      aria-label={title}
    >
      <div className="live-band-label">{title}</div>
      <div className="live-pipe-stages" role="list">
        {stages.map((st, i) => {
          const n = Number(st.count);
          const known = Number.isFinite(n);
          const pct = known ? Math.max(6, (n / total) * 100) : 6;
          return (
            <Link
              key={st.key}
              to={st.to}
              role="listitem"
              className={cn(
                "live-pipe-stage",
                st.tone === "warn" && "is-warn",
                st.tone === "hot" && "is-hot",
                st.tone === "good" && "is-good",
                known && n > 0 && "has-count",
              )}
            >
              <div className="live-pipe-stage-top">
                <b className="display tabular-nums">
                  {known ? <TickNumber value={n} /> : "—"}
                </b>
                {i < stages.length - 1 ? (
                  <span className="live-pipe-chev" aria-hidden>
                    ›
                  </span>
                ) : null}
              </div>
              <span className="live-pipe-label">{st.label}</span>
              <i
                className="live-pipe-fill"
                style={{ width: `${Math.min(100, pct)}%` }}
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
