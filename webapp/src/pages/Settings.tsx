import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Save, LogOut, Loader2, User, Mail, Phone, Shield, Printer, Wifi } from "lucide-react";
import { getPrintConfig } from "@/lib/thermal";
import { PairTerminalCard } from "@/components/payments/PairTerminalCard";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@ls/design/ui/avatar";
import { useMe } from "@/lib/session";
import { signOut } from "@/lib/authClient";
import { initials } from "@ls/design/format";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMutation } from "@tanstack/react-query";

function PrinterSettings() {
  const { data: config, isLoading, isError, refetch } = useQuery({
    queryKey: ["print-config"],
    queryFn: getPrintConfig,
    staleTime: 60_000,
  });

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Printer className="h-4 w-4 text-brass" />
        <span className="text-base sm:text-sm text-cream font-medium">Epson TM-M30II Printer</span>
      </div>
      <p className="text-xs text-cream-dim leading-relaxed">
        Printer settings are managed in ERPNext LSH Print Settings. Printing now runs through the backend so browsers do not connect directly to the Epson.
      </p>
      <div className="rounded-xl bg-brass/10 border border-brass/20 p-3 text-xs text-cream-muted space-y-1">
        <p className="font-medium text-cream">Current ERPNext configuration</p>
        {isLoading ? (
          <p>Loading printer config…</p>
        ) : isError ? (
          <p className="text-signal-amber">Could not load printer config.</p>
        ) : (
          <>
            <p>Enabled: <span className="text-cream">{config?.enabled ? "Yes" : "No"}</span></p>
            <p>Printer: <span className="font-mono text-brass-shimmer">{config?.printer_ip}:{config?.printer_port}</span></p>
            <p>Timeout: <span className="text-cream">{config?.timeout}s</span></p>
            <p>App URL: <span className="text-cream">{config?.app_base_url}</span></p>
          </>
        )}
      </div>
      <Button variant="outline" className="btn-ghost-brass" onClick={() => refetch()}>
        <Wifi className="h-4 w-4 mr-1.5" /> Refresh printer config
      </Button>
    </GlassCard>
  );
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  store_manager: "Store Manager",
  salesperson: "Salesperson",
  driver: "Driver",
};

function Field({ label, icon: Icon, value, onChange, type = "text", disabled = false }: {
  label: string; icon: React.ElementType; value: string;
  onChange: (v: string) => void; type?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label className="ui-label block mb-1.5">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cream-dim" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full text-base sm:text-sm bg-forest-raised/50 border border-brass/20 rounded-xl pl-9 pr-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(me?.name ?? "");
  const [phone, setPhone] = useState((me as any)?.phone ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [avatar, setAvatar] = useState(me?.image ?? "");

  const updateMe = useMutation({
    mutationFn: (input: any) => api.patch<any>("/api/me", input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Profile saved."); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Photo must be under 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatar(dataUrl);
      updateMe.mutate({ image: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = () => {
    const updates: any = { name, phone };
    updateMe.mutate(updates);
  };

  const handleSignOut = async () => {
    await signOut();
    qc.clear();
    navigate("/login");
  };

  if (!me) return <div className="text-cream-muted text-sm">Loading…</div>;

  return (
    <div className="space-y-6 animate-fade-up max-w-2xl">
      <SectionHeader
        eyebrow="House · Settings"
        title={<>Your <span className="text-brass-shimmer">station</span>.</>}
        description="Profile, access, and account settings."
      />

      {/* ── Profile ── */}
      <GlassCard variant="strong" className="p-6 space-y-5">
        <div className="ui-label">Profile</div>

        {/* Avatar */}
        <div className="flex items-center gap-5">
          <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
            <Avatar className="h-20 w-20 border-2 border-brass/30 shadow-brass-glow">
              <AvatarImage src={avatar || undefined} />
              <AvatarFallback className="bg-forest-raised text-brass-light text-xl font-display italic">
                {initials(name || me.name)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="h-5 w-5 text-cream" />
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </div>
          <div>
            <div className="text-base sm:text-sm text-cream font-medium">{me.name}</div>
            <div className="text-xs text-cream-dim mt-0.5">{me.email}</div>
            <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 text-[10px] rounded-full border border-brass/25 bg-brass/10 text-brass-light">
              <Shield className="h-2.5 w-2.5" /> {ROLE_LABEL[me.role] ?? me.role}
            </div>
            <div className="text-[10px] text-cream-dim mt-1">Click photo to change</div>
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          <Field label="Full Name" icon={User} value={name} onChange={setName} />
          <Field label="Phone" icon={Phone} value={phone} onChange={setPhone} type="tel" />
          <Field label="Email" icon={Mail} value={email} onChange={() => {}} disabled
            type="email" />
          <div className="text-[10px] text-cream-dim -mt-2">Email changes require account support.</div>
        </div>

        <Button className="btn-brass" onClick={handleSaveProfile} disabled={updateMe.isPending}>
          {updateMe.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Profile
        </Button>
      </GlassCard>

      {/* ── Change Password ── */}
      <GlassCard className="p-6">
        <div className="ui-label mb-3">Change Password</div>
        <p className="text-base sm:text-sm text-cream-muted mb-4">
          Passwords are managed through ERPNext. Click below to update yours.
        </p>
        <a
          href="https://erp.lstailors.com/update-password"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" className="btn-ghost-brass">
            Change password in ERPNext →
          </Button>
        </a>
      </GlassCard>

      {/* ── Printer ── */}
      <PrinterSettings />

      {/* ── Square Terminal ── */}
      <PairTerminalCard />

      {/* ── Sign out ── */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base sm:text-sm text-cream font-medium">Sign out</div>
            <div className="text-xs text-cream-dim mt-0.5">You'll need to sign back in.</div>
          </div>
          <Button variant="outline" className="border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
