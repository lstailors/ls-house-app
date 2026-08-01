import { useEffect } from "react";
import { useParams } from "react-router-dom";

const ALTS =
  (import.meta.env.VITE_ALTS_PUBLIC_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://alts.lstailors.com";

// Old /garments/:ticketId/:garmentId → alts /g/ job card
export default function GarmentTagRedirect() {
  const { ticketId, garmentId } = useParams();

  useEffect(() => {
    if (!ticketId || !garmentId) {
      window.location.replace(ALTS);
      return;
    }
    window.location.replace(
      `${ALTS}/g/${encodeURIComponent(ticketId)}/${encodeURIComponent(garmentId)}`,
    );
  }, [ticketId, garmentId]);

  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
      Opening garment on Alterations…
    </div>
  );
}
