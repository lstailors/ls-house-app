/**
 * Body-map zone icons for alts intake redesign v2.
 * One garment silhouette; zone lights up where the work sits.
 */
import { cn } from "@ls/design/utils";

const J = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export type BodyZoneId =
  | "sleeves"
  | "shoulders"
  | "collar"
  | "body"
  | "length"
  | "lining"
  | "buttons"
  | "repairs"
  | "waist"
  | "seat"
  | "legs"
  | "hem"
  | "zipper"
  | "other";

type IconProps = {
  zone?: BodyZoneId | null;
  size?: number;
  active?: boolean;
  className?: string;
};

/** Jacket silhouette with optional zone highlight */
export function JacketZone({ zone, size = 44, active, className }: IconProps) {
  const hl = active ? "#0C1810" : "#D3AE72";
  const hlFill = active ? "rgba(12,24,16,0.22)" : "rgba(211,174,114,0.30)";
  const base = active ? "rgba(12,24,16,0.55)" : "rgba(241,233,214,0.34)";
  const H = {
    fill: hlFill,
    stroke: hl,
    strokeWidth: 1.6,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      viewBox="0 0 48 56"
      width={size}
      height={(size * 56) / 48}
      aria-hidden
      className={cn(className)}
    >
      <g {...J} style={{ color: base }}>
        <path d="M13 9 L6 13 L4 36 L11 37.5 L13.5 20" />
        <path d="M35 9 L42 13 L44 36 L37 37.5 L34.5 20" />
        <path d="M13 9 L13 51 L35 51 L35 9" />
        <path d="M13 9 L24 20 L35 9" />
        <path d="M19 14.5 L24 20 L24 51" />
        <path d="M29 14.5 L24 20" />
        <path d="M15.5 38 h5.5 M27 38 h5.5" />
      </g>

      {zone === "sleeves" && (
        <g>
          <path d="M13 9 L6 13 L4 36 L11 37.5 L13.5 20 Z" {...H} />
          <path d="M35 9 L42 13 L44 36 L37 37.5 L34.5 20 Z" {...H} />
        </g>
      )}
      {zone === "shoulders" && (
        <path
          d="M13 9 L6 13 L7 18 L13.2 15.5 L13 9 M35 9 L42 13 L41 18 L34.8 15.5 L35 9 M13 9 L18 12.5 L24 13.5 L30 12.5 L35 9"
          {...H}
        />
      )}
      {zone === "collar" && (
        <path d="M13 9 L19 14.5 L24 20 L29 14.5 L35 9 L30 6.5 L24 11 L18 6.5 Z" {...H} />
      )}
      {zone === "body" && (
        <g>
          <path d="M13 22 L13 44 L18 44 L18 22 Z" {...H} />
          <path d="M35 22 L35 44 L30 44 L30 22 Z" {...H} />
        </g>
      )}
      {zone === "length" && <path d="M13 44 L35 44 L35 51 L13 51 Z" {...H} />}
      {zone === "lining" && (
        <g>
          <path d="M15.5 20 L15.5 48.5 L22 48.5 L22 22 Z" {...H} strokeDasharray="2.6 2" />
          <path d="M32.5 20 L32.5 48.5 L26 48.5 L26 22 Z" {...H} strokeDasharray="2.6 2" />
        </g>
      )}
      {zone === "buttons" && (
        <g fill={hl} stroke="none">
          <circle cx="24" cy="28" r="2.2" />
          <circle cx="24" cy="36" r="2.2" />
          <circle cx="24" cy="44" r="2.2" />
        </g>
      )}
      {zone === "repairs" && (
        <g stroke={hl} strokeWidth="1.7" fill="none" strokeLinecap="round">
          <path d="M12 49 L30 27" />
          <path d="M30 27 L36 20" />
          <circle cx="37.5" cy="18.5" r="1.5" />
          <path d="M17 42 c4.5-.6 6-4.2 3.4-5.4 -2.3-1 -4.6 1.8 -1.4 3.2" />
        </g>
      )}
    </svg>
  );
}

/** Trouser silhouette with zone highlight */
export function TrouserZone({ zone, size = 44, active, className }: IconProps) {
  const hl = active ? "#0C1810" : "#D3AE72";
  const hlFill = active ? "rgba(12,24,16,0.22)" : "rgba(211,174,114,0.30)";
  const base = active ? "rgba(12,24,16,0.55)" : "rgba(241,233,214,0.34)";
  const H = {
    fill: hlFill,
    stroke: hl,
    strokeWidth: 1.6,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      viewBox="0 0 48 56"
      width={size}
      height={(size * 56) / 48}
      aria-hidden
      className={cn(className)}
    >
      <g {...J} style={{ color: base }}>
        <path d="M16 8 L14 20 L12 54 L20 54 L22 28 L26 28 L28 54 L36 54 L34 20 L32 8 Z" />
        <path d="M16 8 L32 8" />
        <path d="M20 12 L28 12" />
      </g>
      {zone === "waist" && <path d="M16 8 L32 8 L31 16 L17 16 Z" {...H} />}
      {zone === "seat" && <path d="M14 18 L18 30 L30 30 L34 18 L32 14 L16 14 Z" {...H} />}
      {zone === "legs" && (
        <g>
          <path d="M14 28 L12 54 L20 54 L21.5 30 Z" {...H} />
          <path d="M34 28 L36 54 L28 54 L26.5 30 Z" {...H} />
        </g>
      )}
      {zone === "hem" && (
        <g>
          <path d="M12 48 L20 48 L20 54 L12 54 Z" {...H} />
          <path d="M28 48 L36 48 L36 54 L28 54 Z" {...H} />
        </g>
      )}
      {zone === "zipper" && <path d="M23 10 L23 26 M25 10 L25 26" {...H} />}
      {zone === "repairs" && (
        <g stroke={hl} strokeWidth="1.7" fill="none" strokeLinecap="round">
          <path d="M14 40 L28 22" />
          <circle cx="30" cy="20" r="1.5" />
        </g>
      )}
    </svg>
  );
}

export function GarmentZoneIcon({
  garmentType,
  zone,
  size = 44,
  active,
  className,
}: IconProps & { garmentType: string }) {
  const g = (garmentType || "").toLowerCase();
  if (g.includes("trouser") || g.includes("pant") || g.includes("jean")) {
    return <TrouserZone zone={zone} size={size} active={active} className={className} />;
  }
  // Default jacket silhouette for coat/suit/blazer/vest (vest still readable)
  return <JacketZone zone={zone} size={size} active={active} className={className} />;
}
