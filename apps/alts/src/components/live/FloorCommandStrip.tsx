import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";
import { TickNumber } from "@alts/components/live/TickNumber";
import { formatCompactMoney } from "@alts/lib/money";
import { HouseAdminLink } from "@alts/components/HouseAdminLink";

export type CommandStat = {
  key: string;
  label: string;
  value: number | string | null | undefined;
  to?: string;
  tone?: "default" | "hot" | "warn" | "good" | "money";
  money?: boolean;
};

export type CommandAction = {
  key: string;
  label: string;
  to?: string;
  external?: boolean;
  primary?: boolean;
  icon?: string;
  admin?: boolean;
};

/**
 * Floor command: Today's desk (big KPIs) stacked over compact quick actions.
 * Full-width desk row is the primary interactive band.
 */
export function FloorCommandStrip({
  stats,
  actions,
  pulse,
  coverMoney,
  canAdmin,
}: {
  stats: CommandStat[];
  actions: CommandAction[];
  pulse?: boolean;
  coverMoney?: boolean;
  canAdmin?: boolean;
}) {
  return (
    <section
      className={cn("live-band live-command", pulse && "is-pulse")}
      data-band="command"
      aria-label="Floor command"
    >
      <div className="live-command-stack">
        <div className="live-command-stats" role="list">
          <div className="live-band-label live-command-label">Today's desk</div>
          <div className="live-command-stat-row">
            {stats.map((s) => {
              const raw = s.value;
              const n = typeof raw === "number" ? raw : Number(raw);
              const known =
                raw != null && raw !== "" && (typeof raw === "string" || Number.isFinite(n));
              const display =
                !known
                  ? "—"
                  : s.money && !coverMoney
                    ? formatCompactMoney(n)
                    : s.money && coverMoney
                      ? "••"
                      : typeof raw === "number"
                        ? undefined
                        : String(raw);
              const body = (
                <>
                  <b className="display tabular-nums">
                    {display != null ? (
                      display
                    ) : (
                      <TickNumber value={Number.isFinite(n) ? n : 0} />
                    )}
                  </b>
                  <span>{s.label}</span>
                </>
              );
              const cls = cn(
                "live-command-stat",
                s.tone === "hot" && "is-hot",
                s.tone === "warn" && "is-warn",
                s.tone === "good" && "is-good",
                s.tone === "money" && "is-money",
                known && typeof raw === "number" && n > 0 && "has-val",
              );
              if (s.to) {
                return (
                  <Link key={s.key} to={s.to} role="listitem" className={cls}>
                    {body}
                  </Link>
                );
              }
              return (
                <div key={s.key} role="listitem" className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>

        <div className="live-command-actions" data-testid="quick-actions">
          <div className="live-band-label live-command-label">Quick actions</div>
          <div className="live-command-action-row">
            {actions.map((a) => {
              if (a.admin) {
                if (!canAdmin) return null;
                return (
                  <HouseAdminLink
                    key={a.key}
                    className={cn("live-command-act", a.primary && "is-primary")}
                    data-testid="qa-admin"
                  >
                    {a.icon ? <span aria-hidden>{a.icon}</span> : null}
                    {a.label}
                  </HouseAdminLink>
                );
              }
              if (!a.to) return null;
              if (a.external) {
                return (
                  <a
                    key={a.key}
                    href={a.to}
                    className={cn("live-command-act", a.primary && "is-primary")}
                  >
                    {a.icon ? <span aria-hidden>{a.icon}</span> : null}
                    {a.label}
                  </a>
                );
              }
              return (
                <Link
                  key={a.key}
                  to={a.to}
                  className={cn("live-command-act", a.primary && "is-primary")}
                >
                  {a.icon ? <span aria-hidden>{a.icon}</span> : null}
                  {a.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
