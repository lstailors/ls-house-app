import { useNavigate } from "react-router-dom";
import {
  UserRound, Mail, Phone, Building2, Shield, LogOut, Bell, KeyRound, Palette, Languages,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { useMe } from "@/lib/session";
import { signOut } from "@/lib/authClient";
import { initials } from "@/lib/format";
import { useState } from "react";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  store_manager: "Store Manager",
  salesperson: "Salesperson",
  driver: "Driver",
};

const ROLE_DESCRIPTION: Record<string, string> = {
  super_admin: "Full house access across every location.",
  store_manager: "Manages this location's daily operations.",
  salesperson: "Books commissions and alterations at the counter.",
  driver: "Carries finished garments to the gentleman's door.",
};

export default function Settings() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [notifNewCommission, setNotifNewCommission] = useState(true);
  const [notifReadyDelivery, setNotifReadyDelivery] = useState(true);
  const [notifInboundComms, setNotifInboundComms] = useState(true);

  const handleSignOut = async () => {
    await signOut();
    qc.clear();
    navigate("/login");
  };

  if (!me) {
    return <div className="text-cream-muted text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-up max-w-3xl">
      <SectionHeader
        eyebrow="House · Settings"
        title={
          <>
            Your <span className="text-brass-shimmer">station</span>.
          </>
        }
        description="Your profile, your alerts, your access. The house's preferences for the gentleman behind the counter."
      />

      {/* Profile */}
      <GlassCard variant="strong" className="p-6">
        <div className="flex items-start gap-5">
          <Avatar className="h-20 w-20 border-2 border-brass/30 shadow-brass-glow">
            <AvatarImage src={me.image ?? undefined} />
            <AvatarFallback className="bg-forest-raised text-brass-light text-xl font-display italic">
              {initials(me.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="ui-label text-[10px] mb-1">Signed in as</div>
            <div className="display-heading text-3xl text-cream truncate">{me.name}</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-cream-dim">
              <span className="flex items-center gap-1.5">
                <Mail className="h-3 w-3" /> {me.email}
              </span>
              {me.location ? (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3 w-3" /> {me.location.name}
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-brass/30 bg-brass/10 text-[10px] uppercase tracking-wider text-brass-light">
                <Shield className="h-3 w-3" /> {ROLE_LABEL[me.role]}
              </div>
              <div className="text-[11px] text-cream-dim mt-2 italic">
                {ROLE_DESCRIPTION[me.role]}
              </div>
            </div>
          </div>
        </div>

        <div className="brass-divider my-5" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ReadOnlyField icon={UserRound} label="Display name" value={me.name} />
          <ReadOnlyField icon={Mail} label="Email" value={me.email} />
          <ReadOnlyField icon={Phone} label="Phone" value="—" />
          <ReadOnlyField
            icon={Building2}
            label="Primary location"
            value={me.location?.name ?? "All locations"}
          />
        </div>
      </GlassCard>

      {/* Notifications */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="h-4 w-4 text-brass-light" />
          <div className="display-heading text-xl text-cream">Notifications</div>
        </div>
        <div className="text-xs text-cream-dim mb-5">
          What the house will tap you on the shoulder for.
        </div>
        <div className="space-y-3">
          <Toggle
            label="New commission booked"
            description="When a fellow salesperson rings up a custom order."
            checked={notifNewCommission}
            onCheckedChange={setNotifNewCommission}
          />
          <Toggle
            label="Garment marked ready"
            description="Workshop signal — a commission is ready for hand-off."
            checked={notifReadyDelivery}
            onCheckedChange={setNotifReadyDelivery}
          />
          <Toggle
            label="Inbound client message"
            description="Sofia routes an SMS or call to your queue."
            checked={notifInboundComms}
            onCheckedChange={setNotifInboundComms}
          />
        </div>
      </GlassCard>

      {/* Appearance + Locale */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Palette className="h-3.5 w-3.5 text-brass-light" />
            <div className="ui-label">Appearance</div>
          </div>
          <div className="rounded-lg border border-brass/20 bg-forest-raised/40 p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brass to-brass-light/40 border border-brass/40" />
            <div className="text-sm">
              <div className="text-cream font-medium">Liquid Glass · Forest</div>
              <div className="text-[10px] text-cream-dim">Default house theme</div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Languages className="h-3.5 w-3.5 text-brass-light" />
            <div className="ui-label">Language &amp; Currency</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-brass/20 bg-forest-raised/40 p-3">
              <div className="ui-label text-[9px]">Lang</div>
              <div className="text-sm text-cream">English (US)</div>
            </div>
            <div className="rounded-lg border border-brass/20 bg-forest-raised/40 p-3">
              <div className="ui-label text-[9px]">Currency</div>
              <div className="text-sm text-cream">USD ($)</div>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Security */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="h-4 w-4 text-brass-light" />
          <div className="display-heading text-xl text-cream">Security</div>
        </div>
        <div className="text-xs text-cream-dim mb-4">
          The keys to the house.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-brass/20 hover:bg-brass/10 text-cream-muted">
            Change password
          </Button>
          <Button variant="outline" className="border-brass/20 hover:bg-brass/10 text-cream-muted">
            Enable two-factor
          </Button>
        </div>
      </GlassCard>

      {/* Sign out */}
      <GlassCard className="p-5 border-signal-rose/20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-cream font-medium">Sign out</div>
            <div className="text-xs text-cream-dim">End this session on this device.</div>
          </div>
          <Button
            onClick={handleSignOut}
            variant="outline"
            className="border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10 hover:text-signal-rose"
          >
            <LogOut className="h-4 w-4 mr-1.5" /> Sign out
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}

function ReadOnlyField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-brass/15 bg-forest-raised/30 p-3">
      <div className="ui-label text-[9px] mb-1 flex items-center gap-1.5">
        <Icon className="h-2.5 w-2.5" /> {label}
      </div>
      <div className="text-sm text-cream truncate">{value}</div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-brass/10 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-cream">{label}</div>
        <div className="text-[11px] text-cream-dim">{description}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="data-[state=checked]:bg-brass data-[state=unchecked]:bg-forest-raised border border-brass/20"
      />
    </div>
  );
}
