// Read-only mode for the admin dashboard's alterations screens.
//
// Alterations are worked at the POS (alts.lstailors.com). app.lstailors.com
// keeps the same screens for oversight, but must not be a second place where
// staff edit tickets — two live surfaces on one ERPNext record is how you get
// a tailor assignment silently overwritten.
//
// Context rather than props: TicketDetail alone is ~1400 lines with mutations
// nested many levels deep, so threading a flag through every sub-component
// would touch far more code than reading it at each action site.
//
// This is a UI guard, not a security boundary — the API is shared and
// unchanged. It stops accidents, not a determined user with the same role.
//
// An earlier version also blocked writes globally inside api.ts as a backstop
// against a missed call site. That was removed: a module-global flag cannot
// tell "inside the provider" from "anywhere else in the app", so with a
// read-only ticket open it also blocked QuickCreateFAB's task creation and the
// AI daily brief's POST on that very page. Guard the actions instead — the
// blast radius of a missed one is far smaller than of a false positive.

import { createContext, useContext, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ExternalLink, Eye } from "lucide-react";
import { POS_ORIGIN } from "./publicOrigin";

const ReadOnlyContext = createContext(false);

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export function ReadOnlyProvider({ children }: { children: ReactNode }) {
  return <ReadOnlyContext.Provider value={true}>{children}</ReadOnlyContext.Provider>;
}

/** Banner explaining why the screen is read-only, with a deep link to the POS. */
export function ReadOnlyBanner() {
  const location = useLocation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-brass/25 bg-brass/5 px-3 py-2">
      <Eye className="h-4 w-4 shrink-0 text-brass-light" />
      <span className="text-sm text-cream-muted">
        View only — alterations are managed at the counter.
      </span>
      <a
        href={`${POS_ORIGIN}${location.pathname}${location.search}`}
        className="ml-auto inline-flex items-center gap-1.5 text-sm text-brass-light hover:text-cream transition-colors"
      >
        Open in POS
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

/**
 * Pathless layout route: wraps a subtree in read-only mode and shows the banner
 * above it, so App.tsx needs one nesting level rather than a per-route change.
 */
export function ReadOnlyLayout() {
  return (
    <ReadOnlyProvider>
      <ReadOnlyBanner />
      <Outlet />
    </ReadOnlyProvider>
  );
}
