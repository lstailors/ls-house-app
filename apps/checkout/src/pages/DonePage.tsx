import { Link } from "react-router-dom";
import { Chrome, PrimaryButton } from "@checkout/components/Chrome";

export default function DonePage() {
  return (
    <div className="checkout-shell items-center justify-center px-6 text-center">
      <div className="display text-4xl text-[var(--bl)]">Done</div>
      <p className="mt-3 text-sm text-[var(--cm)]">Ticket closed on the desk. Ready for the next scan.</p>
      <div className="mt-8 w-full max-w-sm">
        <Link to="/">
          <PrimaryButton label="Back to desk" />
        </Link>
        <Link to="/scan" className="mt-3 block">
          <button type="button" className="btn-ghost w-full min-h-[48px] text-xs font-bold uppercase tracking-wider">
            Scan next
          </button>
        </Link>
      </div>
      <Chrome title="" />
    </div>
  );
}
