// Interstitial for routes that have moved to the alterations POS.
//
// Staff will have app.lstailors.com/intake/alterations bookmarked and in muscle
// memory for weeks after the cutover. Deleting the route outright would drop
// them on a 404 mid-customer; this hands them over instead, and says why.

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowRight, Scissors } from "lucide-react";
import { GlassCard } from "@/components/glass/GlassCard";
import { POS_ORIGIN } from "@/lib/publicOrigin";

const DELAY_MS = 2500;

export function MovedToPos({ what = "Alterations" }: { what?: string }) {
  const location = useLocation();
  const target = `${POS_ORIGIN}${location.pathname}${location.search}`;
  const [cancelled, setCancelled] = useState(false);

  // In development both apps are served from the same origin, so redirecting
  // would just land back here in a loop. Only hand over when the POS really is
  // somewhere else.
  const isSameOrigin = POS_ORIGIN === window.location.origin;

  useEffect(() => {
    if (cancelled || isSameOrigin) return;
    const t = setTimeout(() => window.location.assign(target), DELAY_MS);
    return () => clearTimeout(t);
  }, [target, cancelled, isSameOrigin]);

  return (
    <GlassCard
      className="mx-auto mt-10 max-w-lg p-8 text-center"
      onMouseDown={() => setCancelled(true)}
    >
      <Scissors className="mx-auto h-8 w-8 text-brass-light" />
      <h1 className="mt-4 font-display text-2xl italic text-cream">
        {what} moved to the counter
      </h1>
      <p className="mt-2 text-sm text-cream-muted">
        This now lives in the alterations POS at{" "}
        <span className="text-brass-light">alts.lstailors.com</span>
        {isSameOrigin ? "." : ". Taking you there…"}
      </p>
      <a
        href={target}
        className="btn-brass mt-6 inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm"
      >
        Go now
        <ArrowRight className="h-4 w-4" />
      </a>
      {cancelled ? (
        <p className="mt-3 text-xs text-cream-dim">Auto-redirect cancelled.</p>
      ) : null}
    </GlassCard>
  );
}
