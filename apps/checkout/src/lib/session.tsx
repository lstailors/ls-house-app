import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";

type SessionState = {
  loading: boolean;
  staff: string | null;
  refresh: () => Promise<void>;
  setStaff: (s: string | null) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setStaff(me.staff);
    } catch {
      setStaff(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("checkout-device")) {
      localStorage.setItem("checkout-device", `iphone-${Math.random().toString(36).slice(2, 8)}`);
    }
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* */
    }
    setStaff(null);
  }, []);

  const value = useMemo(
    () => ({ loading, staff, refresh, setStaff, logout }),
    [loading, staff, refresh, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("SessionProvider missing");
  return v;
}
