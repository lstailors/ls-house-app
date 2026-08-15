import { Link } from "react-router-dom";
import { BrandSeal } from "@alts/components/BrandSeal";
import "@alts/styles/alts-pos.css";

const LINKS: Array<{ to: string; label: string; hint: string }> = [
  { to: "/", label: "Home", hint: "Tiles" },
  { to: "/shop-floor", label: "Shop floor", hint: "Work in progress" },
  { to: "/intake/kind", label: "New ticket", hint: "Walk-in · order · redo" },
  { to: "/pickup", label: "Pickup", hint: "Ready bags" },
  { to: "/qc", label: "QC", hint: "MTM inspections" },
  { to: "/reports", label: "Reports", hint: "Floor snapshot" },
  { to: "/customers", label: "Customers", hint: "The book" },
  { to: "/tasks", label: "Tasks", hint: "Open ToDos" },
];

export default function NotFound() {
  return (
    <div className="alts-root min-h-dvh bg-forest-deep text-cream flex flex-col items-center px-5 py-10">
      <BrandSeal size={56} />
      <p className="caps text-brass-light mt-6">Lost in the house</p>
      <h1 className="display text-5xl sm:text-6xl mt-2 text-center">This page isn’t here.</h1>
      <p className="text-sm text-cream-dim mt-3 max-w-md text-center leading-relaxed">
        That address isn’t a floor in Alterations. Pick a section — nothing was redirected in silence.
      </p>
      <nav className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl" aria-label="Main sections">
        {LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="rounded-2xl border border-brass/25 bg-black/25 px-4 py-3 hover:border-brass/50 hover:bg-brass/10 transition-colors"
          >
            <div className="text-cream font-semibold">{l.label}</div>
            <div className="text-[11px] uppercase tracking-widest text-cream-dim mt-0.5">{l.hint}</div>
          </Link>
        ))}
      </nav>
    </div>
  );
}
