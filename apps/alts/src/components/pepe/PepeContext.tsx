import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type PepeDocContext = { doctype: string; name: string };

type PepePanelState = {
  open: boolean;
  context: PepeDocContext | null;
  contextPending: boolean;
  openAsk: (ctx?: PepeDocContext) => void;
  close: () => void;
  consumeContext: () => PepeDocContext | null;
};

const Ctx = createContext<PepePanelState | null>(null);

export function PepeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<PepeDocContext | null>(null);
  const [contextPending, setContextPending] = useState(false);

  const openAsk = useCallback((ctx?: PepeDocContext) => {
    setContext(ctx ?? null);
    setContextPending(Boolean(ctx?.doctype && ctx?.name));
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const consumeContext = useCallback(() => {
    if (!contextPending) return null;
    setContextPending(false);
    return context;
  }, [context, contextPending]);

  const value = useMemo(
    () => ({ open, context, contextPending, openAsk, close, consumeContext }),
    [open, context, contextPending, openAsk, close, consumeContext],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePepePanel() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePepePanel must be used inside PepeProvider");
  return v;
}

export function usePepePanelOptional() {
  return useContext(Ctx);
}
