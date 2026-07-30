import { Link } from "react-router-dom";
import { cn } from "@ls/design/utils";

type BrandSealProps = {
  /** Link target. Default home. Pass null for non-link. */
  to?: string | null;
  className?: string;
  size?: number;
  title?: string;
};

/**
 * L&S Custom Tailors logo seal — replaces the old italic "LS" chip.
 * Clickable to home by default.
 */
export function BrandSeal({
  to = "/",
  className,
  size = 40,
  title = "L&S Custom Tailors — Home",
}: BrandSealProps) {
  const img = (
    <img
      src="/ls-logo-mark.png"
      alt="L&S Custom Tailors"
      width={size}
      height={size}
      draggable={false}
      className="block w-full h-full object-cover select-none"
    />
  );

  const cls = cn("seal seal-logo shrink-0", className);

  if (to === null) {
    return (
      <div className={cls} style={{ width: size, height: size }} title={title} aria-hidden>
        {img}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className={cls}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    >
      {img}
    </Link>
  );
}

export default BrandSeal;
