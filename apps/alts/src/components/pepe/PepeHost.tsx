import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { kioskFromSearch } from "@alts/lib/kiosk";
import { PepeProvider, usePepePanel } from "./PepeContext";
import PepeFab from "./PepeFab";
import { shouldHidePepeFab } from "./pepeHide";
import PepePanel from "./PepePanel";
import { PEPE_EMAIL, pepeApi } from "./pepeApi";

/** Global Pepe chrome. Lives at App (not only AltsShell) so Intake / shop-floor also get the FAB. */
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

  const skipUnread = hidden || kioskFromSearch(search) || /^\/intake(\/|$)/i.test(pathname);
  const unreadQ = useQuery({
    queryKey: ["pepe", "unread"],
    queryFn: () => pepeApi.messages(20),
    enabled: Boolean(me) && wired && !open && !skipUnread,
    refetchInterval: skipUnread ? false : 30_000,
    staleTime: 15_000,
  });
  const last = unreadQ.data?.[unreadQ.data.length - 1];
  const unread = Boolean(
    last &&
      last.owner?.toLowerCase() === PEPE_EMAIL &&
      last.owner?.toLowerCase() !== me?.email?.toLowerCase(),
  );

  if (hidden) return null;

  return (
    <>
      <PepeFab unread={unread} />
      <PepePanel wired={wired} />
    </>
  );
}
