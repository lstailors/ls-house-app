import { useEffect, useRef, useState } from "react";

/** Serif numeral that ticks to the new value over ~400ms. */
export function TickNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setShown(to);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 400);
      const eased = 1 - (1 - p) * (1 - p);
      setShown(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const display = format ? format(shown) : String(Math.round(shown));
  return (
    <span className={className} data-tick={value}>
      {display}
    </span>
  );
}
