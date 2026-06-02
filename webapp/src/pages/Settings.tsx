import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Save, KeyRound, LogOut, Loader2, User, Mail, Phone, Shield, Printer, Wifi } from "lucide-react";
import { getPrinterIp, setPrinterIp } from "@/lib/thermal";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMe } from "@/lib/session";
import { signOut } from "@/lib/authClient";
import { initials } from "@/lib/format";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMutation } from "@tanstack/react-query";

function PrinterSettings() {
  const [ip, setIp] = useState(getPrinterIp);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setPrinterIp(ip);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast.success("Printer IP saved");
  };

  return (
    <GlassCard className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Printer className="h-4 w-4 text-brass" />
        <span className="text-sm text-cream font-medium">Epson TM-M30II Printer</span>
      </div>
      <p className="text-xs text-cream-dim leading-relaxed">
        Enter your printer's IP address (find it by holding Feed while powering on — it prints a self-test with the IP).
        Your phone/iPad must be on the same WiFi as the printer.
      </p>
      <div className="space-y-2">
        <label className="ui-label block">Printer IP Address</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Wifi className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brass/50" />
            <input
              type="text"
              value={ip}
              onChange={e => setIp(e.target.value)}
              placeholder="192.168.1.x"
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-forest-raised/50 border border-brass/20 rounded-xl text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50"
            />
          </div>
          <Button className="btn-brass" onClick={handleSave}>
            {saved ? "Saved ✓" : "Save"}
          </Button>
        </div>
      </div>
      {ip && (
        <a
          href={`http://${ip}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-brass-shimmer underline"
        >
          Open http://{ip} in Safari first → allows local network printing
        </a>
      )}
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
          className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl pl-9 pr-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 disabled:opacity-50 disabled:cursor-not-allowed"
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

  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  const updateMe = useMutation({
    mutationFn: (input: any) => api.patch<any>("/api/me", input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Profile saved."); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const changePw = useMutation({
    mutationFn: (pw: string) => api.post<any>("/api/me/password", { password: pw }),
    onSuccess: () => { toast.success("Password updated."); setNewPw(""); setConfirmPw(""); setShowPw(false); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update password"),
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

  const handleChangePw = () => {
    if (newPw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { toast.error("Passwords don't match"); return; }
    changePw.mutate(newPw);
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
            <div className="text-sm text-cream font-medium">{me.name}</div>
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
      <GlassCard variant="strong" className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="ui-label">Change Password</div>
          <button onClick={() => setShowPw(!showPw)} className="text-xs text-brass-light hover:text-brass transition-colors">
            {showPw ? "Cancel" : "Change"}
          </button>
        </div>

        {showPw && (
          <div className="space-y-4">
            <div>
              <label className="ui-label block mb-1.5">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50"
              />
            </div>
            <div>
              <label className="ui-label block mb-1.5">Confirm Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Repeat new password"
                className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50"
              />
            </div>
            <Button className="btn-brass" onClick={handleChangePw} disabled={changePw.isPending}>
              {changePw.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
              Update Password
            </Button>
          </div>
        )}
        {!showPw && <p className="text-xs text-cream-dim">Click "Change" to set a new password.</p>}
      </GlassCard>

      {/* ── Printer ── */}
      <PrinterSettings />

      {/* ── Sign out ── */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-cream font-medium">Sign out</div>
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
