/**
 * Customer portal profile editor — phones, emails, multi-address.
 * Writes ERP Contact + Address via /api/portal/me (two-way).
 */
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMe } from "@ls/auth";
import { Loader2, ArrowLeft, Plus, Trash2, Save, MapPin, Phone, Mail } from "lucide-react";
import { toast } from "sonner";

const API_BASE = import.meta.env.VITE_BACKEND_URL || "";

type PhoneRow = { number: string; label?: string; isPrimary?: boolean };
type EmailRow = { email: string; isPrimary?: boolean };
type AddrRow = {
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
  _delete?: boolean;
};

function authHeaders(json = false): HeadersInit {
  const token =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("ls_session") || localStorage.getItem("token") || ""
      : "";
  return {
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const emptyAddr = (): AddrRow => ({
  type: "Personal",
  line1: "",
  line2: "",
  city: "",
  state: "",
  zip: "",
  country: "United States",
  isBilling: false,
  isShipping: true,
});

export default function CustomerProfile() {
  const { data: me, isLoading: meLoading } = useMe();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferredName, setPreferredName] = useState("");
  const [preferredContact, setPreferredContact] = useState("SMS");
  const [smsOptIn, setSmsOptIn] = useState(true);
  const [phones, setPhones] = useState<PhoneRow[]>([{ number: "", label: "Mobile", isPrimary: true }]);
  const [emails, setEmails] = useState<EmailRow[]>([{ email: "", isPrimary: true }]);
  const [addresses, setAddresses] = useState<AddrRow[]>([emptyAddr()]);
  const [customerName, setCustomerName] = useState("");
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => {
    if (meLoading) return;
    if (!me) {
      navigate("/login", { replace: true, state: { from: { pathname: "/profile" } } });
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const [meRes, invRes] = await Promise.all([
          fetch(`${API_BASE}/api/portal/me`, { credentials: "include", headers: authHeaders() }),
          fetch(`${API_BASE}/api/portal/invoices`, { credentials: "include", headers: authHeaders() }),
        ]);
        if (meRes.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        const json = await meRes.json();
        const c = json?.data?.customer;
        if (!c) {
          toast.error("No client record linked to this login");
          navigate("/home", { replace: true });
          return;
        }
        setCustomerName(c.name || "");
        setPreferredName(c.preferredName || "");
        setPreferredContact(c.preferredContact || "SMS");
        setSmsOptIn(c.smsOptIn !== false);
        setPhones(
          c.phones?.length
            ? c.phones.map((p: any) => ({
                number: p.number || "",
                label: p.label || "Mobile",
                isPrimary: !!p.isPrimary,
              }))
            : [{ number: c.phone || "", label: "Mobile", isPrimary: true }],
        );
        setEmails(
          c.emails?.length
            ? c.emails.map((e: any) => ({ email: e.email || "", isPrimary: !!e.isPrimary }))
            : [{ email: c.email || "", isPrimary: true }],
        );
        setAddresses(
          c.addresses?.length
            ? c.addresses.map((a: any) => ({
                id: a.id,
                title: a.title,
                type: a.type || "Personal",
                line1: a.line1 || "",
                line2: a.line2 || "",
                city: a.city || "",
                state: a.state || "",
                zip: a.zip || "",
                country: a.country || "United States",
                isBilling: !!a.isBilling,
                isShipping: !!a.isShipping,
              }))
            : [emptyAddr()],
        );
        if (invRes.ok) {
          const invJson = await invRes.json();
          setInvoices(invJson?.data?.invoices || []);
        }
      } catch {
        toast.error("Failed to load profile");
      } finally {
        setLoading(false);
      }
    })();
  }, [me, meLoading, navigate]);

  const save = async () => {
    setSaving(true);
    try {
      const cleanPhones = phones
        .map((p, i) => ({
          number: p.number.trim(),
          label: p.label || "Mobile",
          isPrimary: p.isPrimary || i === 0,
        }))
        .filter((p) => p.number);
      if (cleanPhones.length && !cleanPhones.some((p) => p.isPrimary)) {
        cleanPhones[0].isPrimary = true;
      }
      const cleanEmails = emails
        .map((e, i) => ({
          email: e.email.trim(),
          isPrimary: e.isPrimary || i === 0,
        }))
        .filter((e) => e.email);
      if (cleanEmails.length && !cleanEmails.some((e) => e.isPrimary)) {
        cleanEmails[0].isPrimary = true;
      }
      const cleanAddrs = addresses
        .filter((a) => !a._delete)
        .map((a) => ({
          id: a.id,
          title: a.title || a.type || "Home",
          type: a.type || "Personal",
          line1: (a.line1 || "").trim(),
          line2: (a.line2 || "").trim(),
          city: (a.city || "").trim(),
          state: (a.state || "").trim(),
          zip: (a.zip || "").trim(),
          country: a.country || "United States",
          isBilling: !!a.isBilling,
          isShipping: !!a.isShipping,
        }))
        .filter((a) => a.line1 || a.city);

      // soft-deletes
      const deleted = addresses
        .filter((a) => a._delete && a.id)
        .map((a) => ({ id: a.id, _delete: true as const, line1: a.line1 || ".", city: a.city || "." }));

      const res = await fetch(`${API_BASE}/api/portal/me`, {
        method: "PATCH",
        credentials: "include",
        headers: authHeaders(true),
        body: JSON.stringify({
          preferredName,
          preferredContact,
          smsOptIn,
          phones: cleanPhones,
          emails: cleanEmails,
          addresses: [...cleanAddrs, ...deleted],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Save failed");
      toast.success("Profile saved — house record updated");
      const c = json?.data?.customer;
      if (c?.addresses) {
        setAddresses(
          c.addresses.map((a: any) => ({
            id: a.id,
            title: a.title,
            type: a.type || "Personal",
            line1: a.line1 || "",
            line2: a.line2 || "",
            city: a.city || "",
            state: a.state || "",
            zip: a.zip || "",
            country: a.country || "United States",
            isBilling: !!a.isBilling,
            isShipping: !!a.isShipping,
          })),
        );
      }
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (meLoading || loading) {
    return (
      <div className="min-h-dvh bg-forest-deep flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-brass animate-spin" />
      </div>
    );
  }

  const field =
    "w-full rounded-lg bg-forest-deep/60 border border-brass/20 px-3 py-2.5 text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50";
  const labelCls =
    "text-brass text-[9px] tracking-[0.18em] uppercase mb-1.5 block";

  return (
    <div className="min-h-dvh bg-forest-deep text-cream">
      <div className="mx-auto max-w-lg px-5 pt-8 pb-24">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/home" className="text-cream-dim hover:text-cream p-1">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="font-display italic text-2xl text-cream">Your profile</div>
            <div className="text-cream-dim text-xs mt-0.5">{customerName}</div>
          </div>
        </div>

        <div className="space-y-5">
          {/* Prefs */}
          <section className="rounded-xl border border-brass/25 bg-forest-raised/70 p-4 space-y-3">
            <div>
              <label className={labelCls} style={{ fontFamily: "Montserrat, sans-serif" }}>
                Preferred name
              </label>
              <input
                className={field}
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                placeholder="What we should call you"
              />
            </div>
            <div>
              <label className={labelCls} style={{ fontFamily: "Montserrat, sans-serif" }}>
                Preferred contact
              </label>
              <select
                className={field}
                value={preferredContact}
                onChange={(e) => setPreferredContact(e.target.value)}
              >
                <option value="SMS">SMS</option>
                <option value="Email">Email</option>
                <option value="Phone">Phone</option>
                <option value="Any">Any</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-cream-muted cursor-pointer">
              <input
                type="checkbox"
                checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                className="rounded border-brass/40"
              />
              SMS updates OK (appointments, ready notices)
            </label>
          </section>

          {/* Phones */}
          <section className="rounded-xl border border-brass/25 bg-forest-raised/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cream text-sm font-medium">
                <Phone className="h-4 w-4 text-brass" /> Phone numbers
              </div>
              <button
                type="button"
                className="text-xs text-brass flex items-center gap-1"
                onClick={() =>
                  setPhones((p) => [...p, { number: "", label: "Mobile", isPrimary: false }])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            {phones.map((p, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  className={field + " flex-1"}
                  value={p.number}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPhones((rows) => rows.map((r, j) => (j === i ? { ...r, number: v } : r)));
                  }}
                  placeholder="Mobile or office"
                />
                <select
                  className={field + " w-28"}
                  value={p.label || "Mobile"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPhones((rows) => rows.map((r, j) => (j === i ? { ...r, label: v } : r)));
                  }}
                >
                  <option>Mobile</option>
                  <option>Work</option>
                  <option>Home</option>
                  <option>Other</option>
                </select>
                <button
                  type="button"
                  className="p-2 text-cream-dim hover:text-signal-amber"
                  onClick={() => setPhones((rows) => rows.filter((_, j) => j !== i))}
                  disabled={phones.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <p className="text-[10px] text-cream-dim">First number is treated as primary mobile.</p>
          </section>

          {/* Emails */}
          <section className="rounded-xl border border-brass/25 bg-forest-raised/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cream text-sm font-medium">
                <Mail className="h-4 w-4 text-brass" /> Email
              </div>
              <button
                type="button"
                className="text-xs text-brass flex items-center gap-1"
                onClick={() => setEmails((e) => [...e, { email: "", isPrimary: false }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            {emails.map((e, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={field + " flex-1"}
                  type="email"
                  value={e.email}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    setEmails((rows) => rows.map((r, j) => (j === i ? { ...r, email: v } : r)));
                  }}
                  placeholder="you@email.com"
                />
                <button
                  type="button"
                  className="p-2 text-cream-dim hover:text-signal-amber"
                  onClick={() => setEmails((rows) => rows.filter((_, j) => j !== i))}
                  disabled={emails.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </section>

          {/* Addresses */}
          <section className="rounded-xl border border-brass/25 bg-forest-raised/70 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cream text-sm font-medium">
                <MapPin className="h-4 w-4 text-brass" /> Addresses
              </div>
              <button
                type="button"
                className="text-xs text-brass flex items-center gap-1"
                onClick={() => setAddresses((a) => [...a, emptyAddr()])}
              >
                <Plus className="h-3.5 w-3.5" /> Add address
              </button>
            </div>
            {addresses
              .map((a, i) => ({ a, i }))
              .filter(({ a }) => !a._delete)
              .map(({ a, i }) => (
                <div
                  key={a.id || i}
                  className="rounded-lg border border-brass/15 bg-forest-deep/40 p-3 space-y-2"
                >
                  <div className="flex justify-between items-center">
                    <select
                      className={field + " w-36"}
                      value={a.type || "Personal"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAddresses((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, type: v } : r)),
                        );
                      }}
                    >
                      <option>Personal</option>
                      <option>Billing</option>
                      <option>Shipping</option>
                      <option>Office</option>
                      <option>Other</option>
                    </select>
                    <button
                      type="button"
                      className="text-xs text-cream-dim hover:text-signal-amber flex items-center gap-1"
                      onClick={() =>
                        setAddresses((rows) =>
                          rows.map((r, j) =>
                            j === i ? (r.id ? { ...r, _delete: true } : r) : r,
                          ).filter((r, j) => !(j === i && !r.id)),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                  <input
                    className={field}
                    placeholder="Street address"
                    value={a.line1 || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAddresses((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, line1: v } : r)),
                      );
                    }}
                  />
                  <input
                    className={field}
                    placeholder="Apt / suite (optional)"
                    value={a.line2 || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAddresses((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, line2: v } : r)),
                      );
                    }}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className={field}
                      placeholder="City"
                      value={a.city || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAddresses((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, city: v } : r)),
                        );
                      }}
                    />
                    <input
                      className={field}
                      placeholder="State"
                      value={a.state || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAddresses((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, state: v } : r)),
                        );
                      }}
                    />
                    <input
                      className={field}
                      placeholder="ZIP"
                      value={a.zip || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAddresses((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, zip: v } : r)),
                        );
                      }}
                    />
                  </div>
                  <div className="flex gap-4 text-xs text-cream-muted pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!a.isBilling}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setAddresses((rows) =>
                            rows.map((r, j) =>
                              j === i
                                ? { ...r, isBilling: on }
                                : on
                                  ? { ...r, isBilling: false }
                                  : r,
                            ),
                          );
                        }}
                      />
                      Billing
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!a.isShipping}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setAddresses((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, isShipping: on } : r)),
                          );
                        }}
                      />
                      Delivery / shipping
                    </label>
                  </div>
                </div>
              ))}
          </section>

          {/* Invoices */}
          <section id="invoices" className="rounded-xl border border-brass/25 bg-forest-raised/70 p-4 space-y-3">
            <div className="text-cream text-sm font-medium">Recent invoices</div>
            {invoices.length === 0 ? (
              <p className="text-cream-dim text-xs">No invoices on file for this login yet.</p>
            ) : (
              <div className="space-y-2">
                {invoices.slice(0, 12).map((inv) => (
                  <a
                    key={inv.id}
                    href={inv.payUrl}
                    className="flex justify-between items-center rounded-lg border border-brass/15 px-3 py-2.5 hover:bg-brass/10 transition-all"
                  >
                    <div>
                      <div className="text-cream text-xs font-mono">{inv.id}</div>
                      <div className="text-cream-dim text-[10px]">{inv.postingDate || ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-cream text-sm font-mono">
                        ${Number(inv.grandTotal || 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-brass uppercase tracking-wider">
                        {Number(inv.outstanding || 0) > 0 ? "Pay" : "Paid"}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* sticky save */}
      <div className="fixed bottom-0 inset-x-0 border-t border-brass/20 bg-forest-deep/95 backdrop-blur-md p-4">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex w-full h-12 items-center justify-center gap-2 rounded-md bg-brass text-forest-deep font-semibold text-sm hover:bg-brass-light disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save to house record
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
