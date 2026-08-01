import { useEffect } from "react";
import { useParams } from "react-router-dom";

const ALTS =
  (import.meta.env.VITE_ALTS_PUBLIC_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://alts.lstailors.com";

/**
 * Old hang-tag QRs open app.lstailors.com/g/… — bounce to alts FOH job card
 * (canonical floor surface after HER-55 / NYC cutover).
 */
export default function AltsGarmentRedirect() {
  const { ticket, garmentId } = useParams<{ ticket: string; garmentId: string }>();

  useEffect(() => {
    if (!ticket || !garmentId) {
      window.location.replace(ALTS);
      return;
    }
    const dest = `${ALTS}/g/${encodeURIComponent(ticket)}/${encodeURIComponent(garmentId)}`;
    window.location.replace(dest);
  }, [ticket, garmentId]);

  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
      Opening garment on Alterations…
    </div>
  );
}
