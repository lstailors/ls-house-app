import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "@checkout/lib/session";
import PinPage from "@checkout/pages/PinPage";
import HomePage from "@checkout/pages/HomePage";
import ScanPage from "@checkout/pages/ScanPage";
import { TicketPage, InvoicePage } from "@checkout/pages/TicketPage";
import PayPage from "@checkout/pages/PayPage";
import OutPage from "@checkout/pages/OutPage";
import ReceiptPage from "@checkout/pages/ReceiptPage";
import DonePage from "@checkout/pages/DonePage";
import { BagAddPage, BagPage } from "@checkout/pages/BagPage";

function Gate({ children }: { children: React.ReactNode }) {
  const { loading, staff } = useSession();
  if (loading) {
    return <div className="checkout-shell grid place-items-center text-[var(--cd)]">Opening…</div>;
  }
  if (!staff) return <Navigate to="/pin" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/pin" element={<PinPage />} />
      <Route
        path="/*"
        element={
          <Gate>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/scan" element={<ScanPage />} />
              <Route path="/t/:name" element={<TicketPage />} />
              <Route path="/i/:name" element={<InvoicePage />} />
              <Route path="/pay" element={<PayPage />} />
              <Route path="/out" element={<OutPage />} />
              <Route path="/receipt" element={<ReceiptPage />} />
              <Route path="/done" element={<DonePage />} />
              <Route path="/bag" element={<BagPage />} />
              <Route path="/bag/add" element={<BagAddPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Gate>
        }
      />
    </Routes>
  );
}
