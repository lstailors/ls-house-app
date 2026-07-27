import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@ls/design/utils";

export type PhoneRow = { key: string; number: string; label: string; isPrimary: boolean };
export type EmailRow = { key: string; email: string; isPrimary: boolean };
export type AddressRow = {
  key: string;
  id?: string;
  title: string;
  type: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  isBilling: boolean;
  isShipping: boolean;
  _delete?: boolean;
};
export type PersonRow = {
  key: string;
  id?: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  _delete?: boolean;
};

type Props = {
  customerId: string;
  customerName?: string;
  onClose: () => void;
  onSaved: (detail: {
    id: string;
    name: string;
    phone: string;
    email: string;
    addressLine?: string;
  }) => void;
};

const PHONE_LABELS = ["Mobile", "Work", "Home", "Other"] as const;
const ADDR_TYPES = ["Personal", "Billing", "Shipping", "Office", "Current", "Permanent", "Other"] as const;
const ROLES = ["Client", "Assistant", "Spouse", "Family", "Other"] as const;

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label ? <span className="caps block mb-1.5">{label}</span> : null}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-11 rounded-xl bg-black/35 border border-brass/25 px-3 text-[14px] text-cream outline-none focus:border-brass placeholder:text-[var(--cd)]"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="block">
      {label ? <span className="caps block mb-1.5">{label}</span> : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl bg-black/35 border border-brass/25 px-3 text-[13px] text-cream outline-none focus:border-brass"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-forest-deep">
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function CustomerEditSheet({ customerId, customerName, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(customerName || "");
  const [notes, setNotes] = useState("");
  const [phones, setPhones] = useState<PhoneRow[]>([{ key: uid(), number: "", label: "Mobile", isPrimary: true }]);
  const [emails, setEmails] = useState<EmailRow[]>([{ key: uid(), email: "", isPrimary: true }]);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<any>(`/api/intake-alterations/customers/${encodeURIComponent(customerId)}`)
      .then((d) => {
        if (cancelled || !d) return;
        setName(d.name || customerName || "");
        setNotes(d.notes || "");

        const pRows: PhoneRow[] = (d.phones?.length ? d.phones : [{ number: d.mobile || "", label: "Mobile", isPrimary: true }]).map(
          (p: any) => ({
            key: uid(),
            number: p.number || "",
            label: p.label || "Mobile",
            isPrimary: !!p.isPrimary,
          }),
        );
        if (!pRows.some((p) => p.isPrimary) && pRows[0]) pRows[0].isPrimary = true;
        setPhones(pRows.length ? pRows : [{ key: uid(), number: "", label: "Mobile", isPrimary: true }]);

        const eRows: EmailRow[] = (d.emails?.length ? d.emails : [{ email: d.email || "", isPrimary: true }]).map((e: any) => ({
          key: uid(),
          email: e.email || "",
          isPrimary: !!e.isPrimary,
        }));
        if (!eRows.some((e) => e.isPrimary) && eRows[0]) eRows[0].isPrimary = true;
        setEmails(eRows.length ? eRows : [{ key: uid(), email: "", isPrimary: true }]);

        const aSrc = d.addresses?.length
          ? d.addresses
          : d.address
            ? [{ ...d.address, type: "Personal", title: "Primary", isBilling: true, isShipping: true }]
            : [];
        setAddresses(
          aSrc.map((a: any) => ({
            key: uid(),
            id: a.id,
            title: a.title || a.type || "",
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

        const peopleSrc = (d.people || []).filter((p: any) => !p.isPrimary || /assistant|spouse|family/i.test(p.role || ""));
        // Only show non-client people in assistants section; client is the customer itself
        setPeople(
          peopleSrc
            .filter((p: any) => p.role !== "Client")
            .map((p: any) => ({
              key: uid(),
              id: p.id,
              name: p.name || "",
              role: p.role || "Assistant",
              phone: p.phone || "",
              email: p.email || "",
              isPrimary: false,
            })),
        );
      })
      .catch(() => toast.error("Could not load customer details"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, customerName]);

  const save = async () => {
    setSaving(true);
    try {
      const cleanPhones = phones.filter((p) => p.number.trim());
      if (!cleanPhones.some((p) => p.isPrimary) && cleanPhones[0]) cleanPhones[0].isPrimary = true;
      const cleanEmails = emails.filter((e) => e.email.trim());
      if (!cleanEmails.some((e) => e.isPrimary) && cleanEmails[0]) cleanEmails[0].isPrimary = true;

      const primaryPhone = cleanPhones.find((p) => p.isPrimary)?.number || cleanPhones[0]?.number || "";
      const primaryEmail = cleanEmails.find((e) => e.isPrimary)?.email || cleanEmails[0]?.email || "";
      const primaryAddr =
        addresses.find((a) => !a._delete && a.isBilling) ||
        addresses.find((a) => !a._delete && a.isShipping) ||
        addresses.find((a) => !a._delete);

      // Dual payload: legacy single fields work on current prod API;
      // multi arrays apply when the expanded customer PATCH is live.
      await api.patch(`/api/intake-alterations/customers/${encodeURIComponent(customerId)}`, {
        notes,
        mobile: primaryPhone,
        email: primaryEmail,
        address: primaryAddr
          ? {
              line1: primaryAddr.line1,
              line2: primaryAddr.line2,
              city: primaryAddr.city,
              state: primaryAddr.state,
              zip: primaryAddr.zip,
              country: primaryAddr.country || "United States",
              title: primaryAddr.title,
              type: primaryAddr.type,
            }
          : undefined,
        phones: cleanPhones.map((p) => ({ number: p.number.trim(), label: p.label, isPrimary: p.isPrimary })),
        emails: cleanEmails.map((e) => ({ email: e.email.trim(), isPrimary: e.isPrimary })),
        addresses: addresses
          .filter((a) => !a._delete || a.id)
          .map((a) => ({
            id: a.id,
            title: a.title || a.type,
            type: a.type,
            line1: a.line1,
            line2: a.line2,
            city: a.city,
            state: a.state,
            zip: a.zip,
            country: a.country || "United States",
            isBilling: a.isBilling,
            isShipping: a.isShipping,
            _delete: a._delete || undefined,
          })),
        people: people
          .filter((p) => p.name.trim() || p._delete)
          .map((p) => ({
            id: p.id,
            name: p.name.trim(),
            role: p.role || "Assistant",
            phone: p.phone.trim(),
            email: p.email.trim(),
            isPrimary: false,
            _delete: p._delete || undefined,
          })),
      });

      const ship =
        addresses.find((a) => !a._delete && a.isShipping) ||
        addresses.find((a) => !a._delete && a.isBilling) ||
        addresses.find((a) => !a._delete);
      const addrBits = ship ? [ship.line1, ship.city, ship.state, ship.zip].filter(Boolean).join(", ") : undefined;

      toast.success("Customer updated in ERPNext");
      onSaved({
        id: customerId,
        name: name || customerName || customerId,
        phone: primaryPhone,
        email: primaryEmail,
        addressLine: addrBits,
      });
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const visibleAddresses = addresses.filter((a) => !a._delete);
  const visiblePeople = people.filter((p) => !p._delete);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-[rgba(4,10,6,0.72)] backdrop-blur-[7px]" aria-label="Close" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl max-h-[94vh] overflow-y-auto rounded-t-[26px] sm:rounded-[22px] border border-brass/30 shadow-[var(--sl)]"
        style={{ background: "linear-gradient(170deg,#16301E,#0E1D12)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-[52px] h-1 rounded-full bg-brass/40 mx-auto mt-2 mb-1 sm:hidden" />
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-brass/15 sticky top-0 z-10"
          style={{ background: "linear-gradient(170deg,#16301E,#122618)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="caps text-brass-light">Edit customer</div>
            <h2 className="display text-[26px] leading-tight truncate">{name || customerName || "Client"}</h2>
            <p className="text-[11px] text-[var(--cd)] mt-1">
              Multiple numbers, residences, and assistants — saved to ERPNext
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-11 h-11 rounded-xl border border-brass/25 bg-black/20 text-cream-dim text-lg">
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-16 grid place-items-center text-cream-dim text-sm">Loading…</div>
        ) : (
          <div className="p-5 space-y-6">
            {/* Phones */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="caps text-brass-light flex-1">Phone numbers</div>
                <button
                  type="button"
                  className="text-[10px] font-bold tracking-widest uppercase text-brass-light"
                  onClick={() => setPhones((prev) => [...prev, { key: uid(), number: "", label: "Work", isPrimary: false }])}
                >
                  + Add number
                </button>
              </div>
              {phones.map((p, i) => (
                <div key={p.key} className="flex flex-wrap gap-2 items-end">
                  <div className="w-[110px]">
                    <SelectField
                      value={p.label}
                      onChange={(v) => setPhones((rows) => rows.map((r, j) => (j === i ? { ...r, label: v } : r)))}
                      options={PHONE_LABELS}
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <Field
                      value={p.number}
                      onChange={(v) => setPhones((rows) => rows.map((r, j) => (j === i ? { ...r, number: v } : r)))}
                      placeholder="+1 917 …"
                      type="tel"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPhones((rows) =>
                        rows.map((r, j) => ({ ...r, isPrimary: j === i })),
                      )
                    }
                    className={cn(
                      "h-11 px-3 rounded-xl border text-[10px] font-bold tracking-wide uppercase",
                      p.isPrimary ? "border-brass bg-brass/20 text-brass-light" : "border-brass/25 text-cream-dim",
                    )}
                  >
                    Primary
                  </button>
                  {phones.length > 1 && (
                    <button
                      type="button"
                      className="h-11 w-11 rounded-xl border border-brass/25 text-cream-dim"
                      onClick={() => setPhones((rows) => rows.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </section>

            {/* Emails */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="caps text-brass-light flex-1">Emails</div>
                <button
                  type="button"
                  className="text-[10px] font-bold tracking-widest uppercase text-brass-light"
                  onClick={() => setEmails((prev) => [...prev, { key: uid(), email: "", isPrimary: false }])}
                >
                  + Add email
                </button>
              </div>
              {emails.map((e, i) => (
                <div key={e.key} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Field
                      value={e.email}
                      onChange={(v) => setEmails((rows) => rows.map((r, j) => (j === i ? { ...r, email: v } : r)))}
                      placeholder="client@example.com"
                      type="email"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setEmails((rows) => rows.map((r, j) => ({ ...r, isPrimary: j === i })))}
                    className={cn(
                      "h-11 px-3 rounded-xl border text-[10px] font-bold tracking-wide uppercase",
                      e.isPrimary ? "border-brass bg-brass/20 text-brass-light" : "border-brass/25 text-cream-dim",
                    )}
                  >
                    Primary
                  </button>
                  {emails.length > 1 && (
                    <button
                      type="button"
                      className="h-11 w-11 rounded-xl border border-brass/25 text-cream-dim"
                      onClick={() => setEmails((rows) => rows.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </section>

            <div className="h-px bg-brass/15" />

            {/* Addresses */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="caps text-brass-light flex-1">Addresses / residences</div>
                <button
                  type="button"
                  className="text-[10px] font-bold tracking-widest uppercase text-brass-light"
                  onClick={() =>
                    setAddresses((prev) => [
                      ...prev,
                      {
                        key: uid(),
                        title: "",
                        type: prev.length ? "Personal" : "Personal",
                        line1: "",
                        line2: "",
                        city: "",
                        state: "",
                        zip: "",
                        country: "United States",
                        isBilling: prev.length === 0,
                        isShipping: prev.length === 0,
                      },
                    ])
                  }
                >
                  + Add address
                </button>
              </div>
              {visibleAddresses.length === 0 && (
                <p className="text-[12px] text-cream-dim">No addresses yet — add home, office, or shipping for delivery.</p>
              )}
              {addresses.map((a, i) => {
                if (a._delete) return null;
                return (
                  <div key={a.key} className="card-glass p-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <div className="flex-1 min-w-[120px]">
                        <Field
                          label="Label"
                          value={a.title}
                          onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, title: v } : r)))}
                          placeholder="NYC apt · Hamptons · Office"
                        />
                      </div>
                      <div className="w-[130px]">
                        <SelectField
                          label="Type"
                          value={a.type}
                          onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, type: v } : r)))}
                          options={ADDR_TYPES}
                        />
                      </div>
                    </div>
                    <Field
                      label="Street line 1"
                      value={a.line1}
                      onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, line1: v } : r)))}
                      placeholder="123 E 61st St"
                    />
                    <Field
                      label="Street line 2"
                      value={a.line2}
                      onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, line2: v } : r)))}
                      placeholder="Apt / floor"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="City" value={a.city} onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, city: v } : r)))} />
                      <Field label="State" value={a.state} onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, state: v } : r)))} />
                      <Field label="ZIP" value={a.zip} onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, zip: v } : r)))} />
                      <Field label="Country" value={a.country} onChange={(v) => setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, country: v } : r)))} />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setAddresses((rows) =>
                            rows.map((r, j) => ({
                              ...r,
                              isBilling: j === i,
                            })),
                          )
                        }
                        className={cn(
                          "h-10 px-3 rounded-xl border text-[10px] font-bold tracking-wide uppercase",
                          a.isBilling ? "border-brass bg-brass/20 text-brass-light" : "border-brass/25 text-cream-dim",
                        )}
                      >
                        Billing
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setAddresses((rows) => rows.map((r, j) => (j === i ? { ...r, isShipping: !r.isShipping } : r)))
                        }
                        className={cn(
                          "h-10 px-3 rounded-xl border text-[10px] font-bold tracking-wide uppercase",
                          a.isShipping ? "border-brass bg-brass/20 text-brass-light" : "border-brass/25 text-cream-dim",
                        )}
                      >
                        Shipping / delivery
                      </button>
                      <button
                        type="button"
                        className="ml-auto h-10 px-3 rounded-xl border border-[rgba(217,123,108,0.4)] text-[10px] font-bold tracking-wide uppercase text-[var(--ro)]"
                        onClick={() =>
                          setAddresses((rows) =>
                            rows.map((r, j) => (j === i ? (r.id ? { ...r, _delete: true } : r) : r)).filter((r, j) => !(j === i && !r.id)),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>

            <div className="h-px bg-brass/15" />

            {/* Assistants / people */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="caps text-brass-light flex-1">Assistants & people</div>
                <button
                  type="button"
                  className="text-[10px] font-bold tracking-widest uppercase text-brass-light"
                  onClick={() =>
                    setPeople((prev) => [
                      ...prev,
                      { key: uid(), name: "", role: "Assistant", phone: "", email: "", isPrimary: false },
                    ])
                  }
                >
                  + Add person
                </button>
              </div>
              <p className="text-[11px] text-cream-dim -mt-1">
                EA, house manager, spouse — separate contact on the client file. SMS still defaults to primary mobile unless you change it later.
              </p>
              {visiblePeople.length === 0 && (
                <p className="text-[12px] text-cream-dim">None yet.</p>
              )}
              {people.map((p, i) => {
                if (p._delete) return null;
                return (
                  <div key={p.key} className="card-glass p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                      <Field
                        label="Name"
                        value={p.name}
                        onChange={(v) => setPeople((rows) => rows.map((r, j) => (j === i ? { ...r, name: v } : r)))}
                        placeholder="Alex Rivera"
                      />
                      <SelectField
                        label="Role"
                        value={p.role}
                        onChange={(v) => setPeople((rows) => rows.map((r, j) => (j === i ? { ...r, role: v } : r)))}
                        options={ROLES.filter((r) => r !== "Client")}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Field
                        label="Phone"
                        value={p.phone}
                        onChange={(v) => setPeople((rows) => rows.map((r, j) => (j === i ? { ...r, phone: v } : r)))}
                        type="tel"
                        placeholder="+1 …"
                      />
                      <Field
                        label="Email"
                        value={p.email}
                        onChange={(v) => setPeople((rows) => rows.map((r, j) => (j === i ? { ...r, email: v } : r)))}
                        type="email"
                      />
                    </div>
                    <button
                      type="button"
                      className="h-10 px-3 rounded-xl border border-[rgba(217,123,108,0.4)] text-[10px] font-bold tracking-wide uppercase text-[var(--ro)]"
                      onClick={() =>
                        setPeople((rows) =>
                          rows
                            .map((r, j) => (j === i ? (r.id ? { ...r, _delete: true } : r) : r))
                            .filter((r, j) => !(j === i && !r.id)),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </section>

            <div className="h-px bg-brass/15" />

            <section className="space-y-2">
              <div className="caps text-brass-light">Notes</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Preferences, fit notes, VIP, dog’s name, building access…"
                className="w-full rounded-xl bg-black/35 border border-brass/25 px-3.5 py-3 text-sm text-cream outline-none resize-none focus:border-brass placeholder:text-[var(--cd)]"
              />
            </section>

            <div className="flex gap-3 pt-1 sticky bottom-0 pb-2"
              style={{ background: "linear-gradient(180deg,transparent,#0E1D12 30%)" }}
            >
              <button type="button" onClick={save} disabled={saving} className="btn-brass flex-1 h-14 text-[11px] disabled:opacity-40">
                {saving ? "Saving…" : "Save to ERPNext"}
              </button>
              <button type="button" onClick={onClose} className="btn-ghost h-14 px-5 text-[11px]">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact selected-customer chip used in intake header / step 0 */
export function SelectedCustomerCard({
  name,
  phone,
  email,
  addressLine,
  onEdit,
  onChange,
}: {
  name: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  onEdit?: () => void;
  onChange?: () => void;
}) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const meta = [phone, email, addressLine].filter(Boolean).join(" · ");

  return (
    <div className="card-glass p-4 flex items-center gap-3">
      <span className="w-12 h-12 rounded-full bg-forest-raised border border-brass/30 grid place-items-center display text-lg text-brass-light shrink-0">
        {initials || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-base truncate">{name}</div>
        <div className="text-[11.5px] text-[var(--cd)] truncate mt-0.5">{meta || "No phone · no email · no address"}</div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
        {onEdit && (
          <button type="button" onClick={onEdit} className="btn-brass h-11 px-4 text-[10px]">
            Edit
          </button>
        )}
        {onChange && (
          <button type="button" onClick={onChange} className="btn-ghost h-11 px-4 text-[10px]">
            Change
          </button>
        )}
      </div>
    </div>
  );
}
