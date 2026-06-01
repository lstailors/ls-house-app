import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Star, Phone, Mail, Building2, MapPin,
  Edit2, Save, X, Trash2, Plus, Tag, Calendar,
  FileText, Heart, Ruler, AlertCircle
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Customer {
  id: string; customerNumber: number | null; name: string;
  firstName: string | null; lastName: string | null;
  phone: string | null; email: string | null;
  company: string | null; titleRole: string | null;
  address: string | null; city: string | null; state: string | null; zipCode: string | null;
  locationId: string | null; status: string; vipTier: string;
  stylePreferences: string | null; fitNotes: string | null; notes: string | null;
  birthday: string | null; anniversary: string | null;
  tags: string[]; casaTier: string | null; communicationPref: string | null;
  preferredContact: string; smsOptedOut: boolean;
  paymentPreference: string | null; creditTerms: string | null;
  referralCode: string | null; referralCredits: number;
  erpnextCustomerId: string | null;
  dossier: any | null;
  createdAt: string; updatedAt: string;
}

const INPUT = "w-full bg-forest-deep border border-brass/20 rounded-lg px-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none";
const LABEL = "ui-label text-cream-muted mb-1 block text-[10px]";

// ── Editable Field ────────────────────────────────────────────────────────────
function Field({ label, value, editing, field, draft, onChange }: {
  label: string; value: string | null; editing: boolean;
  field: string; draft: any; onChange: (f: string, v: string) => void;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {editing ? (
        <input
          className={INPUT}
          value={draft[field] ?? ""}
          onChange={e => onChange(field, e.target.value)}
          placeholder={label}
        />
      ) : (
        <p className="text-cream text-sm">{value || <span className="text-cream-dim italic">—</span>}</p>
      )}
    </div>
  );
}

function TextArea({ label, value, editing, field, draft, onChange }: {
  label: string; value: string | null; editing: boolean;
  field: string; draft: any; onChange: (f: string, v: string) => void;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {editing ? (
        <textarea
          rows={3}
          className={cn(INPUT, "resize-none")}
          value={draft[field] ?? ""}
          onChange={e => onChange(field, e.target.value)}
          placeholder={label}
        />
      ) : (
        <p className="text-cream text-sm whitespace-pre-wrap">{value || <span className="text-cream-dim italic">—</span>}</p>
      )}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-5 border border-brass/10">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-brass-light" />
        <h3 className="ui-label text-brass-light tracking-wider">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [newTag, setNewTag] = useState("");

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api.get<Customer>(`/api/customers/${id}`),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => api.patch(`/api/customers/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      setEditing(false);
      toast.success("Client updated.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/customers/${id}`),
    onSuccess: () => { navigate("/customers"); toast.success("Client archived."); },
    onError: (e: any) => toast.error(e?.message ?? "Archive failed"),
  });

  if (isLoading) return <div className="text-cream-muted text-sm p-8">Loading…</div>;
  if (error || !customer) return (
    <div className="text-signal-rose text-sm p-8 flex items-center gap-2">
      <AlertCircle className="w-4 h-4" /> Client not found.
    </div>
  );

  const c = customer as any;

  const startEdit = () => {
    setDraft({
      full_name: c.name,
      first_name: c.firstName,
      last_name: c.lastName,
      phone: c.phone,
      email: c.email,
      company: c.company,
      title_role: c.titleRole,
      address: c.address,
      city: c.city,
      state: c.state,
      zip_code: c.zipCode,
      vip_tier: c.vipTier,
      status: c.status,
      style_preferences: c.stylePreferences,
      fit_notes: c.fitNotes,
      notes: c.notes,
      birthday: c.birthday,
      anniversary: c.anniversary,
      tags: [...(c.tags ?? [])],
      communication_pref: c.communicationPref,
      preferred_contact: c.preferredContact,
      payment_preference: c.paymentPreference,
      credit_terms: c.creditTerms,
    });
    setEditing(true);
  };

  const onChange = (field: string, value: string) => setDraft((d: any) => ({ ...d, [field]: value }));

  const saveEdits = () => updateMutation.mutate(draft);

  const addTag = () => {
    if (!newTag.trim()) return;
    const tags = [...(draft.tags ?? c.tags ?? []), newTag.trim()];
    setDraft((d: any) => ({ ...d, tags }));
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    const tags = (draft.tags ?? c.tags ?? []).filter((t: string) => t !== tag);
    setDraft((d: any) => ({ ...d, tags }));
  };

  const currentTags = editing ? (draft.tags ?? []) : (c.tags ?? []);
  const isVip = c.vipTier !== "Standard";

  return (
    <div className="space-y-6 animate-fade-up max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button onClick={() => navigate("/customers")} className="mt-1 p-1.5 rounded-lg hover:bg-brass/10 text-cream-dim hover:text-cream transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="font-display italic text-3xl text-cream">{c.name}</h1>
              {isVip && <Star className="w-4 h-4 text-brass fill-brass" />}
              {c.casaTier && (
                <span className="text-[9px] tracking-widest font-bold uppercase px-2 py-1 rounded border border-brass/30 text-brass-light bg-brass/5">CASA {c.casaTier}</span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="ui-label text-[10px]">#{c.customerNumber ?? "—"}</span>
              <span className={cn("text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border",
                c.vipTier === "Platinum" ? "border-purple-400/40 text-purple-300 bg-purple-900/20" :
                c.vipTier === "Gold" ? "border-brass/40 text-brass-shimmer bg-brass/10" :
                "border-brass/15 text-cream-dim"
              )}>{c.vipTier}</span>
              <span className="text-[10px] text-cream-dim bg-brass/8 border border-brass/10 rounded px-2 py-0.5">{c.locationId ?? "—"}</span>
              {c.status !== "Active" && <span className="text-[10px] text-signal-rose border border-signal-rose/30 bg-signal-rose/10 rounded px-2 py-0.5">{c.status}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} className="border-brass/20 text-cream-muted">
                <X className="w-3.5 h-3.5 mr-1" /> Cancel
              </Button>
              <Button className="btn-brass" onClick={saveEdits} disabled={updateMutation.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" /> {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={startEdit} className="border-brass/20 text-cream-muted hover:bg-brass/10">
                <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
              <Button variant="outline" onClick={() => { if (confirm("Archive this client?")) deleteMutation.mutate(); }}
                className="border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contact */}
        <Section title="Contact" icon={Phone}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" value={c.firstName} editing={editing} field="first_name" draft={draft} onChange={onChange} />
            <Field label="Last Name" value={c.lastName} editing={editing} field="last_name" draft={draft} onChange={onChange} />
          </div>
          <Field label="Phone" value={c.phone} editing={editing} field="phone" draft={draft} onChange={onChange} />
          <Field label="Email" value={c.email} editing={editing} field="email" draft={draft} onChange={onChange} />
          <Field label="Company" value={c.company} editing={editing} field="company" draft={draft} onChange={onChange} />
          <Field label="Title / Role" value={c.titleRole} editing={editing} field="title_role" draft={draft} onChange={onChange} />
        </Section>

        {/* Address */}
        <Section title="Address" icon={MapPin}>
          <Field label="Street" value={c.address} editing={editing} field="address" draft={draft} onChange={onChange} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" value={c.city} editing={editing} field="city" draft={draft} onChange={onChange} />
            <Field label="State" value={c.state} editing={editing} field="state" draft={draft} onChange={onChange} />
            <Field label="ZIP" value={c.zipCode} editing={editing} field="zip_code" draft={draft} onChange={onChange} />
          </div>
        </Section>

        {/* Profile */}
        <Section title="Profile" icon={Star}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>VIP Tier</label>
              {editing ? (
                <select className={INPUT} value={draft.vip_tier ?? c.vipTier} onChange={e => onChange("vip_tier", e.target.value)}>
                  {["Standard", "Silver", "Gold", "Platinum"].map(t => <option key={t}>{t}</option>)}
                </select>
              ) : <p className="text-cream text-sm">{c.vipTier}</p>}
            </div>
            <div>
              <label className={LABEL}>Status</label>
              {editing ? (
                <select className={INPUT} value={draft.status ?? c.status} onChange={e => onChange("status", e.target.value)}>
                  {["Active", "Inactive", "Archived"].map(s => <option key={s}>{s}</option>)}
                </select>
              ) : <p className="text-cream text-sm">{c.status}</p>}
            </div>
            <Field label="Birthday" value={c.birthday} editing={editing} field="birthday" draft={draft} onChange={onChange} />
            <Field label="Anniversary" value={c.anniversary} editing={editing} field="anniversary" draft={draft} onChange={onChange} />
          </div>
          <div>
            <label className={LABEL}>Preferred Contact</label>
            {editing ? (
              <select className={INPUT} value={draft.preferred_contact ?? c.preferredContact} onChange={e => onChange("preferred_contact", e.target.value)}>
                {["email", "phone", "sms"].map(p => <option key={p}>{p}</option>)}
              </select>
            ) : <p className="text-cream text-sm capitalize">{c.preferredContact}</p>}
          </div>
        </Section>

        {/* Tags */}
        <Section title="Tags" icon={Tag}>
          <div className="flex flex-wrap gap-1.5 min-h-[32px]">
            {currentTags.map((tag: string) => (
              <span key={tag} className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-brass/25 bg-brass/8 text-cream-muted text-xs">
                {tag}
                {editing && (
                  <button onClick={() => removeTag(tag)} className="text-cream-dim hover:text-signal-rose ml-1">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}
            {currentTags.length === 0 && !editing && <span className="text-cream-dim text-xs italic">No tags</span>}
          </div>
          {editing && (
            <div className="flex gap-2 mt-2">
              <input
                className={cn(INPUT, "flex-1")}
                placeholder="Add tag…"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addTag()}
              />
              <Button onClick={addTag} variant="outline" size="sm" className="border-brass/20 text-cream-muted px-2">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </Section>

        {/* Style & Fit */}
        <Section title="Style & Fit" icon={Ruler}>
          <TextArea label="Style Preferences" value={c.stylePreferences} editing={editing} field="style_preferences" draft={draft} onChange={onChange} />
          <TextArea label="Fit Notes" value={c.fitNotes} editing={editing} field="fit_notes" draft={draft} onChange={onChange} />
        </Section>

        {/* Notes & Dossier */}
        <Section title="Notes & Dossier" icon={FileText}>
          <TextArea label="Internal Notes" value={c.notes} editing={editing} field="notes" draft={draft} onChange={onChange} />
          {c.dossier && (
            <div className="space-y-2 pt-2 border-t border-brass/10">
              {c.dossier.family_context && (
                <div>
                  <label className={LABEL}>Family Context</label>
                  <p className="text-cream-muted text-xs">{c.dossier.family_context}</p>
                </div>
              )}
              {c.dossier.professional_context && (
                <div>
                  <label className={LABEL}>Professional</label>
                  <p className="text-cream-muted text-xs">{c.dossier.professional_context}</p>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Billing */}
        <Section title="Billing" icon={Heart}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment Preference" value={c.paymentPreference} editing={editing} field="payment_preference" draft={draft} onChange={onChange} />
            <Field label="Credit Terms" value={c.creditTerms} editing={editing} field="credit_terms" draft={draft} onChange={onChange} />
            <div>
              <label className={LABEL}>Referral Credits</label>
              <p className="text-brass-shimmer font-display italic">${c.referralCredits?.toFixed(2) ?? "0.00"}</p>
            </div>
            <div>
              <label className={LABEL}>Referral Code</label>
              <p className="text-cream text-sm font-mono">{c.referralCode ?? "—"}</p>
            </div>
          </div>
        </Section>

        {/* System */}
        <Section title="System" icon={Calendar}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className={LABEL}>ERPNext ID</label>
              <p className="text-cream-dim font-mono">{c.erpnextCustomerId ?? "—"}</p>
            </div>
            <div>
              <label className={LABEL}>Casa Tier</label>
              <p className="text-cream">{c.casaTier ?? "—"}</p>
            </div>
            <div>
              <label className={LABEL}>Created</label>
              <p className="text-cream-dim">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</p>
            </div>
            <div>
              <label className={LABEL}>Last Updated</label>
              <p className="text-cream-dim">{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "—"}</p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
