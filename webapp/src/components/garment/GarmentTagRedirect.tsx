import { Navigate, useParams } from "react-router-dom";

// Consolidation: the old /garments/:ticketId/:garmentId page is retired in
// favour of the richer /g/:ticket/:garmentId job card (the single source of
// truth). Redirect so every entry point — scan, link, old bookmark — lands
// on the same screen. Param names differ (ticketId/garmentId → ticket/garment).
export default function GarmentTagRedirect() {
  const { ticketId, garmentId } = useParams();
  if (!ticketId || !garmentId) return <Navigate to="/" replace />;
  return (
    <Navigate
      to={`/g/${encodeURIComponent(ticketId)}/${encodeURIComponent(garmentId)}`}
      replace
    />
  );
}
