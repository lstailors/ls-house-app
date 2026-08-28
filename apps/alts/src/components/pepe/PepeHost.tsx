import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { kioskFromSearch } from "@alts/lib/kiosk";
import { PepeProvider, usePepePanel } from "./PepeContext";
import PepeFab from "./PepeFab";
import { shouldHidePepeFab } from "./pepeHide";
import PepePanel from "./PepePanel";
import { PEPE_EMAIL, pepeApi } from "./pepeApi";

/** Global Pepe chrome — top-bar AI orb + dropdown on every authenticated FOH route. */
export default function PepeHost() {
  return <PepeChrome />;
}

export { PepeProvider };

function PepeChrome() {
  const { data: me } = useMe();
  const { pathname, search } = useLocation();
  const { open } = usePepePanel();
  const hidden = !me || shouldHidePepeFab(pathname, search);

  const meQ = useQuery({
    queryKey: ["pepe", "me"],
    queryFn: () => pepeApi.me(),
    enabled: Boolean(me) && !hidden,
    staleTime: 30_000,
  });
  const wired = Boolean(meQ.data?.pepeChannelId);

  const skipPoll = hidden || kioskFromSearch(search) || /^\/intake(\/|$)/i.test(pathname);

  const unreadQ = useQuery({
    queryKey: ["pepe", "unread"],
    queryFn: () => pepeApi.messages(20),
    enabled: Boolean(me) && wired && !open && !skipPoll,
    refetchInterval: skipPoll ? false : 30_000,
    staleTime: 15_000,
  });

  const todosQ = useQuery({
    queryKey: ["pepe", "todos"],
    queryFn: () => pepeApi.todos(),
    enabled: Boolean(me) && wired && !skipPoll,
    refetchInterval: skipPoll || open ? false : 45_000,
    staleTime: 20_000,
  });

  const last = unreadQ.data?.[unreadQ.data.length - 1];
  const unreadMsg = Boolean(
    last &&
      (last.is_pepe || last.owner?.toLowerCase() === PEPE_EMAIL) &&
      last.owner?.toLowerCase() !== me?.email?.toLowerCase(),
  );

  const openTodos = (todosQ.data ?? []).filter(
    (t) => !/^(closed|cancelled|completed|done)$/i.test(t.status || ""),
  ).length;

  const badge = openTodos + (unreadMsg ? 1 : 0);

  if (hidden) return null;

  return (
    <>
      <PepeFab badge={badge} unread={unreadMsg} />
      <PepePanel wired={wired} todoCount={openTodos} />
    </>
  );
}
