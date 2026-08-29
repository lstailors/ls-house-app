import { Link } from "react-router-dom";

export function Chrome({
  title,
  sub,
  backTo,
  right,
}: {
  title: string;
  sub?: string;
  backTo?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 px-4 pt-3 pb-2">
      {backTo ? (
        <Link
          to={backTo}
          className="grid h-10 w-10 flex-none place-items-center rounded-full border border-[var(--line)] bg-[rgba(15,34,24,0.7)] text-lg text-[var(--cr)]"
          aria-label="Back"
        >
          ‹
        </Link>
      ) : (
        <div className="h-10 w-10 flex-none" />
      )}
      <div className="min-w-0 flex-1">
        <h1 className="display text-2xl leading-none text-[var(--cr)]">{title}</h1>
        {sub ? <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">{sub}</div> : null}
      </div>
      {right}
    </header>
  );
}

export function MoneyDue({ label, amount }: { label?: string; amount: number }) {
  return (
    <div className="text-right">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">{label || "Due"}</div>
      <div className="display mt-1 text-[22px] text-[var(--bl)]">
        {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount || 0)}
      </div>
    </div>
  );
}

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string },
) {
  const { className, children, label, ...rest } = props;
  return (
    <button
      type="button"
      className={`btn-brass w-full min-h-[56px] px-4 text-[13px] disabled:opacity-40 ${className || ""}`}
      {...rest}
    >
      {children || label}
    </button>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--cd)]">
      {children}
    </div>
  );
}
