// LocationContext — drives the "viewing as" location filter for super_admin.
// All API hooks should call useActiveLocation() and pass it through as ?locationId=
// For non-super_admin users, this is fixed to their own locationId.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Profile } from "@ls/types";

interface LocationContextValue {
  activeLocationId: string | null; // null = "All" (super_admin only)
  setActiveLocationId: (id: string | null) => void;
}

const Ctx = createContext<LocationContextValue>({
  activeLocationId: null,
  setActiveLocationId: () => {},
});

const STORAGE_KEY = "lsh.activeLocationId";

export function LocationProvider({
  children,
  user,
}: {
  children: ReactNode;
  user: Profile | null;
}) {
  const [activeLocationId, setActiveLocationIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "null" ? null : stored;
  });

  // For non-super_admin users, force their assigned location.
  useEffect(() => {
    if (!user) return;
    if (user.role !== "super_admin") {
      setActiveLocationIdState(user.locationId ?? null);
    }
  }, [user]);

  const setActiveLocationId = (id: string | null) => {
    setActiveLocationIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id ?? "null");
    }
  };

  return (
    <Ctx.Provider value={{ activeLocationId, setActiveLocationId }}>
      {children}
    </Ctx.Provider>
  );
}

export function useActiveLocation() {
  return useContext(Ctx);
}

export function locationQueryString(activeLocationId: string | null): string {
  if (!activeLocationId) return "";
  return `?locationId=${encodeURIComponent(activeLocationId)}`;
}
