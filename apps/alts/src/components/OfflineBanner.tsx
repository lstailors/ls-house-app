import { useEffect, useState } from "react";
import { formatShopClock, useShopLink } from "../offline/status";
import { snapshotLabel } from "../offline/hydrate";

export function OfflineBanner() {
  const link = useShopLink();
  const [asOf, setAsOf] = useState("");

  useEffect(() => {
    if (link !== "offline") return;
    void snapshotLabel().then((iso) => setAsOf(formatShopClock(iso)));
  }, [link]);

  if (link !== "offline") return null;

  return (
    <div className="offline-banner" data-testid="offline-banner" role="status">
      Offline — showing shop data{asOf ? ` as of ${asOf}` : ""}. Changes will sync when you're back.
    </div>
  );
}
