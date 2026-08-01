import { Navigate, useParams } from "react-router-dom";

// Consolidation: the old /garments/:ticketId/:garmentId page is retired in
// favour of the richer /g/:ticket/:garmentId job card (the single source of
// truth). Redirect so every entry point — scan, link, old bookmark — lands
// on the same screen.
// Supports both /garments/:ticketId/:garmentId and legacy /garments/:token
// (token may be "ticket/garment" or opaque — opaque falls through to home).
export default function GarmentTagRedirect() {
  const { ticketId, garmentId, token } = useParams();
  const ticket = ticketId || (token?.includes("/") ? token.split("/")[0] : undefined);
  const garment =
    garmentId || (token?.includes("/") ? token.split("/").slice(1).join("/") : undefined);
  if (!ticket || !garment) return <Navigate to="/" replace />;
  return (
    <Navigate
      to={`/g/${encodeURIComponent(ticket)}/${encodeURIComponent(garment)}`}
      replace
    />
  );
}
