// Shared authentication gate for app shells.
//
// Extracted from AppShell so the alterations POS shell (src/alts/AltsShell.tsx)
// reuses exactly the same loading/redirect behaviour instead of reimplementing
// it. The two shells differ in chrome — the POS wants touch-sized targets and no
// global search — but must never differ in who is allowed in.
//
// Returns `gate` as a ReactNode to render instead of the shell when the user is
// still loading or not signed in, and a non-null `user` once it is null.

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useMe } from "@/lib/session";
import type { Profile } from "@/lib/types";
import { Monogram } from "../glass/Monogram";

export function useAuthGate(loadingLabel = "Preparing the atelier…"): {
  user: Profile | null;
  gate: ReactNode | null;
} {
  const { data: user, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) {
    return {
      user: null,
      gate: (
        <div className="flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Monogram size="lg" className="animate-glow-pulse" />
            <div className="ui-label">{loadingLabel}</div>
          </div>
        </div>
      ),
    };
  }

  if (!user) {
    return { user: null, gate: <Navigate to="/login" replace state={{ from: location }} /> };
  }

  return { user, gate: null };
}
