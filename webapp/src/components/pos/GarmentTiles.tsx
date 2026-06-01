import { Shirt, Scissors, Wind } from "lucide-react";
import type { GarmentType } from "@/lib/types";
import { CONSTRUCTION_LABOR, GARMENT_LABEL } from "@/lib/pricing";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  value: GarmentType | undefined;
  onChange: (g: GarmentType) => void;
}

// Minimalist garment icons rendered inline to avoid bringing in an icon set
// for shapes lucide doesn't ship.
function JacketIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14 L12 22 L14 50 L20 56 L32 52 L44 56 L50 50 L52 22 L44 14 L32 22 Z" />
      <path d="M32 22 L32 52" />
      <path d="M26 30 L26 36 M38 30 L38 36" />
    </svg>
  );
}
function SuitIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 8 L12 16 L16 30 L20 56 L32 52 L44 56 L48 30 L52 16 L44 8 L32 16 Z" />
      <path d="M32 16 L32 52" />
      <path d="M22 38 L24 56 M42 38 L40 56" />
    </svg>
  );
}
function TrousersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10 L46 10 L48 22 L42 56 L34 56 L32 30 L30 56 L22 56 L16 22 Z" />
      <path d="M32 10 L32 30" />
    </svg>
  );
}
function VestIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14 L20 50 L32 56 L44 50 L44 14 L32 22 Z" />
      <path d="M32 22 L32 56" />
      <path d="M28 34 L28 38 M36 34 L36 38" />
    </svg>
  );
}
function OvercoatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10 L10 18 L12 60 L20 60 L20 28 L20 60 L44 60 L44 28 L44 60 L52 60 L54 18 L46 10 L32 18 Z" />
      <path d="M32 18 L32 60" />
    </svg>
  );
}

const GARMENT_ORDER: GarmentType[] = ["jacket", "suit", "trousers", "vest", "overcoat", "shirt"];

const GARMENT_ICON: Record<GarmentType, (props: { className?: string }) => JSX.Element> = {
  jacket: JacketIcon,
  suit: SuitIcon,
  trousers: TrousersIcon,
  vest: VestIcon,
  overcoat: OvercoatIcon,
  shirt: ({ className }) => <Shirt className={className} />,
};

const GARMENT_DESC: Record<GarmentType, string> = {
  jacket: "Single jacket",
  suit: "Two-piece",
  trousers: "Trousers only",
  vest: "Waistcoat",
  overcoat: "Topcoat / overcoat",
  shirt: "Bespoke shirt",
};

export function GarmentTiles({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {GARMENT_ORDER.map((g) => {
        const Icon = GARMENT_ICON[g];
        const active = value === g;
        return (
          <button
            key={g}
            type="button"
            onClick={() => onChange(g)}
            aria-pressed={active}
            className={cn(
              "group relative overflow-hidden rounded-xl border p-4 text-left transition-all duration-200",
              "min-h-[120px] flex flex-col justify-between",
              active
                ? "border-brass bg-brass/15 shadow-brass-glow"
                : "border-brass/15 bg-forest-raised/30 hover:border-brass/40 hover:bg-brass/5",
            )}
          >
            <div
              className={cn(
                "pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full blur-3xl transition-opacity",
                active ? "bg-brass/30 opacity-100" : "bg-brass/15 opacity-0 group-hover:opacity-60",
              )}
            />
            <div className="relative flex items-start justify-between">
              <Icon className={cn("h-8 w-8 transition-colors", active ? "text-brass-light" : "text-cream-muted group-hover:text-brass-light")} />
              {value === g ? (
                <Scissors className="h-3.5 w-3.5 text-brass animate-glow-pulse" />
              ) : null}
            </div>
            <div className="relative">
              <div className={cn("display-heading text-lg leading-tight", active ? "text-cream" : "text-cream-muted")}>
                {GARMENT_LABEL[g]}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-cream-dim mt-0.5">
                {GARMENT_DESC[g]}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[10px] text-brass-light/80">
                <Wind className="h-3 w-3" />
                <span>Labor {formatUSD(CONSTRUCTION_LABOR[g], { compact: true })}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
