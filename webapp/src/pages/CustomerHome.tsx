/**
 * Customer portal home — my.lstailors.com/home
 * Linked ERP Customer contact book (view) + nav to edit profile.
 */
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMe } from "@ls/auth";
import {
  Loader2,
  MapPin,
  Phone,
  Mail,
  FileText,
  User,
  LogOut,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_BACKEND_URL || "";

type PortalPhone = { number: string; label?: string; isPrimary?: boolean };
type PortalEmail = { email: string; isPrimary?: boolean };
type PortalAddress = {
  id?: string;
  title?: string;
  type?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  isBilling?: boolean;
  isShipping?: boolean;
};

type PortalCustomer = {
  id: string;
  name: string;
  preferredName?: string | null;
  phone?: string | null;
  email?: string | null;
  phones?: PortalPhone[];
  emails?: PortalEmail[];
  addresses?: PortalAddress[];
  preferredContact?: string;
  smsOptIn?: boolean;
};

function authHeaders(): HeadersInit {
  // api-client cookie session is preferred; bearer fallback if present
  const token =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("ls_session") || localStorage.getItem("token") || ""
      : "";
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function CustomerHome() {
  const { data: me, isLoading: meLoading } = useMe();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (meLoading) return;
    if (!me) {
      navigate("/login", { replace: true, state: { from: { pathname: "/home" } } });
      return;
    }
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/api/portal/me`, {
          credentials: "include",
          headers: authHeaders(),
        });
        if (res.status === 401) {
          navigate("/login", { replace: true, state: { from: { pathname: "/home" } } });
          return;
        }
        if (!res.ok) throw new Error("Could not load your profile");
        const json = await res.json();
        setLinked(!!json?.data?.linked);
        setCustomer(json?.data?.customer || null);
      } catch (e: any) {
        setError(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [me, meLoading, navigate]);

  const first =
    customer?.preferredName ||
    customer?.name?.split(/\s+/)[0] ||
    me?.name?.split(/\s+/)[0] ||
    "there";

  if (meLoading || loading) {
    return (
      <div className="min-h-dvh bg-forest-deep flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-brass animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-forest-deep text-cream">
      <div className="mx-auto max-w-lg px-5 pt-10 pb-16">
        <div className="flex items-start justify-between gap-3 mb-8">
          <div>
            <div className="font-display italic text-3xl text-cream leading-tight">
              Welcome, {first}
            </div>
            <div
              className="text-brass text-[10px] tracking-[0.22em] uppercase mt-2"
              style={{ fontFamily: "Montserrat, sans-serif" }}
            >
              L&S Custom Tailors · Client portal
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="text-cream-dim text-xs hover:text-cream flex items-center gap-1"
          >
            <LogOut className="h-3.5 w-3.5" /> Account
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-signal-amber/30 bg-signal-amber/10 p-3 text-sm text-signal-amber">
            {error}
          </div>
        )}

        {!linked || !customer ? (
          <div className="rounded-xl border border-brass/25 bg-forest-raised/60 p-5 space-y-3">
            <p className="text-cream text-sm">
              We couldn’t match <span className="text-brass">{me?.email}</span> to a
              client record yet.
            </p>
            <p className="text-cream-muted text-xs leading-relaxed">
              Text or call Concierge at (212) 308-4431 and we’ll link your account. You can still
              open invoices from your email pay links.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Contact summary */}
            <section className="rounded-xl border border-brass/25 bg-forest-raised/70 p-5">
              <div className="flex items-center justify-between mb-3">
                <div
                  className="text-brass text-[10px] tracking-[0.2em] uppercase"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  Your contact info
                </div>
                <Link
                  to="/profile"
                  className="text-xs text-brass hover:text-brass-light flex items-center gap-0.5"
                >
                  Edit <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="text-cream font-medium text-base mb-3">{customer.name}</div>
              <div className="space-y-2 text-sm">
                {(customer.phones?.length
                  ? customer.phones
                  : customer.phone
                    ? [{ number: customer.phone, label: "Mobile", isPrimary: true }]
                    : []
                ).map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-cream-muted">
                    <Phone className="h-3.5 w-3.5 text-brass shrink-0" />
                    <span className="text-cream">{p.number}</span>
                    {p.label && (
                      <span className="text-[10px] uppercase tracking-wider text-cream-dim">
                        {p.label}
                      </span>
                    )}
                  </div>
                ))}
                {(customer.emails?.length
                  ? customer.emails
                  : customer.email
                    ? [{ email: customer.email, isPrimary: true }]
                    : []
                ).map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-cream-muted">
                    <Mail className="h-3.5 w-3.5 text-brass shrink-0" />
                    <span className="text-cream break-all">{e.email}</span>
                  </div>
                ))}
                {(customer.addresses || []).length === 0 && (
                  <div className="flex items-start gap-2 text-cream-dim text-xs">
                    <MapPin className="h-3.5 w-3.5 text-brass shrink-0 mt-0.5" />
                    No address on file — add one in Edit.
                  </div>
                )}
                {(customer.addresses || []).map((a) => (
                  <div key={a.id || a.line1} className="flex items-start gap-2 text-cream-muted">
                    <MapPin className="h-3.5 w-3.5 text-brass shrink-0 mt-0.5" />
                    <div className="text-sm leading-snug">
                      <div className="text-cream">
                        {[a.line1, a.line2].filter(Boolean).join(", ")}
                      </div>
                      <div className="text-cream-dim text-xs">
                        {[a.city, a.state, a.zip].filter(Boolean).join(", ")}
                        {(a.isBilling || a.isShipping) && (
                          <span className="ml-2 text-brass/80 uppercase tracking-wider text-[9px]">
                            {a.isBilling ? "Billing" : ""}
                            {a.isBilling && a.isShipping ? " · " : ""}
                            {a.isShipping ? "Shipping" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Link
                to="/profile"
                className="mt-4 flex w-full h-11 items-center justify-center gap-2 rounded-md border border-brass/40 text-cream text-sm font-medium hover:bg-brass/10 transition-all"
              >
                <User className="h-4 w-4 text-brass" />
                Update phones & addresses
              </Link>
            </section>

            {/* Invoices */}
            <Link
              to="/profile#invoices"
              className="block rounded-xl border border-brass/25 bg-forest-raised/70 p-5 hover:border-brass/40 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-brass" />
                  <div>
                    <div className="text-cream text-sm font-medium">Invoices</div>
                    <div className="text-cream-dim text-xs">View & pay open balances</div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-cream-dim" />
              </div>
            </Link>

            <div className="rounded-xl border border-brass/15 bg-forest-raised/40 p-4 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-signal-emerald shrink-0 mt-0.5" />
              <p className="text-cream-dim text-xs leading-relaxed">
                Changes here update your L&S house record instantly — same Contact & Address used
                for fittings, deliveries, and invoices.
              </p>
            </div>
          </div>
        )}

        <p className="text-center text-cream-dim text-[10px] mt-10 leading-relaxed">
          138 E 61st Street, Suite 201 · New York
          <br />
          Concierge (212) 308-4431 · concierge@lstailors.com
        </p>
      </div>
    </div>
  );
}
