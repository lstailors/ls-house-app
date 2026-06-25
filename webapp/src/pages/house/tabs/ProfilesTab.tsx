import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, Pencil, Cpu, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { MODEL_OPTIONS, PROVIDER_OPTIONS, SKILL_OPTIONS } from "../mockData";
import { SkeletonGrid } from "../components/shared";
import { toast } from "sonner";

interface LiveProfile {
  id: string;
  name: string;
  model: string;
  provider: string;
  status: "active" | "inactive";
  description: string;
  isDefault?: boolean;
}

function ProfileCard({
  profile,
  onEdit,
  onSetActive,
}: {
  profile: LiveProfile;
  onEdit: (p: LiveProfile) => void;
  onSetActive: (p: LiveProfile) => void;
}) {
  const active = profile.status === "active";
  return (
    <div className={cn(
      "glass-panel glass-panel-hover rounded-2xl p-5 border border-brass/10 flex flex-col",
      !active && "opacity-70",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="h-4 w-4 text-brass-light shrink-0" />
          <span className="font-display italic text-xl text-cream truncate">{profile.name}</span>
          {profile.isDefault ? (
            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-medium uppercase tracking-wider border border-brass/30 text-brass-light bg-brass/10">
              Default
            </span>
          ) : null}
        </div>
        <span className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border shrink-0",
          active
            ? "text-signal-emerald border-signal-emerald/30 bg-signal-emerald/10"
            : "text-cream-dim border-brass/15 bg-cream/5",
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-signal-emerald" : "bg-cream-dim/50")} />
          {active ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="ui-label text-[9px]">Model</span>
          <span className="font-mono text-[11px] text-cream-muted">{profile.model}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="ui-label text-[9px]">Provider</span>
          <span className="text-[11px] text-cream-muted">{profile.provider}</span>
        </div>
        {profile.description ? (
          <div className="text-[10px] text-cream-dim/70 leading-snug pt-1">{profile.description}</div>
        ) : null}
      </div>

      <div className="mt-5 flex gap-2">
        <Button
          size="sm"
          onClick={() => onSetActive(profile)}
          disabled={active}
          className={cn(
            "flex-1 h-8 text-xs",
            active
              ? "bg-cream/5 border border-brass/10 text-cream-dim cursor-not-allowed hover:bg-cream/5"
              : "btn-brass",
          )}
        >
          <Check className="h-3 w-3 mr-1" /> {active ? "Active" : "Set Active"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onEdit(profile)}
          className="h-8 text-xs border-brass/20 text-cream hover:bg-brass/10 hover:text-cream"
        >
          <Pencil className="h-3 w-3 mr-1" /> Edit
        </Button>
      </div>
    </div>
  );
}

function ProfileDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Partial<LiveProfile> | null;
  onSave: (p: Partial<LiveProfile>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [model, setModel] = useState(initial?.model ?? MODEL_OPTIONS[0]);
  const [provider, setProvider] = useState(initial?.provider ?? PROVIDER_OPTIONS[0]);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [skills, setSkills] = useState<string[]>([]);

  const toggleSkill = (s: string) =>
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Profile name is required");
      return;
    }
    onSave({ id: initial?.id, name: name.trim(), model, provider, description, status: initial?.status ?? "active" });
  };

  const isEdit = !!initial?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-forest-deep/95 backdrop-blur-2xl border border-brass/20 text-cream max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-cream font-medium">
            {isEdit ? "Edit Profile" : "New Profile"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="ui-label block mb-1.5">Profile name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Analyst"
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="ui-label block mb-1.5">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="bg-forest-raised/50 border-brass/20 text-cream text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-forest-deep border-brass/20 text-cream">
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m} className="text-cream focus:bg-brass/15 focus:text-cream font-mono text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="ui-label block mb-1.5">Provider</label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="bg-forest-raised/50 border-brass/20 text-cream text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-forest-deep border-brass/20 text-cream">
                  {PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p} className="text-cream focus:bg-brass/15 focus:text-cream">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="ui-label block mb-1.5">Skills</label>
            <div className="flex flex-wrap gap-1.5">
              {SKILL_OPTIONS.map((s) => {
                const on = skills.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSkill(s)}
                    className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-mono border transition-colors",
                      on
                        ? "bg-brass/20 border-brass/40 text-brass-light"
                        : "bg-cream/5 border-brass/15 text-cream-dim hover:border-brass/30",
                    )}
                  >
                    {on ? "✓ " : ""}{s}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="ui-label block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this profile for?"
              className="w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 resize-none h-20"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="btn-brass">
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass-panel rounded-2xl p-8 border border-brass/10 flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-cream-dim">Could not load profiles.</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
      </Button>
    </div>
  );
}

export default function ProfilesTab() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Partial<LiveProfile> | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["house-profiles"],
    queryFn: () => api.get<{ profiles: LiveProfile[] }>("/api/house/profiles"),
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (updated: LiveProfile[]) =>
      api.post<{ profiles: LiveProfile[] }>("/api/house/profiles", { profiles: updated }),
    onSuccess: (res) => {
      qc.setQueryData(["house-profiles"], res);
      toast.success("Profiles saved");
      setDialogOpen(false);
      setEditTarget(null);
    },
    onError: () => toast.error("Failed to save profiles"),
  });

  const profiles: LiveProfile[] = data?.profiles ?? [];

  const handleSave = (incoming: Partial<LiveProfile>) => {
    const existing = profiles.find((p) => p.id === incoming.id);
    let next: LiveProfile[];

    if (existing) {
      next = profiles.map((p) =>
        p.id === incoming.id ? { ...p, ...incoming } as LiveProfile : p
      );
    } else {
      const newProfile: LiveProfile = {
        id: incoming.name?.toLowerCase().replace(/\s+/g, "-") ?? `p-${Date.now()}`,
        name: incoming.name ?? "",
        model: incoming.model ?? MODEL_OPTIONS[0],
        provider: incoming.provider ?? PROVIDER_OPTIONS[0],
        status: "active",
        description: incoming.description ?? "",
      };
      next = [...profiles, newProfile];
    }

    saveMutation.mutate(next);
  };

  const handleSetActive = (profile: LiveProfile) => {
    const next = profiles.map((p) => ({
      ...p,
      status: (p.id === profile.id ? "active" : p.status) as "active" | "inactive",
    }));
    saveMutation.mutate(next);
  };

  const openNew = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (p: LiveProfile) => {
    setEditTarget(p);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">HERMES PROFILES</span>
        </div>
        <Button size="sm" onClick={openNew} className="btn-brass h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> New Profile
        </Button>
      </div>

      {isLoading ? (
        <SkeletonGrid count={3} h="h-56" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {profiles.map((p) => (
            <ProfileCard key={p.id} profile={p} onEdit={openEdit} onSetActive={handleSetActive} />
          ))}
          {profiles.length === 0 ? (
            <div className="col-span-full glass-panel rounded-2xl p-8 border border-brass/10 text-center">
              <p className="text-sm text-cream-dim">No profiles yet. Create one to get started.</p>
            </div>
          ) : null}
        </div>
      )}

      <ProfileDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditTarget(null); }}
        initial={editTarget}
        onSave={handleSave}
        saving={saveMutation.isPending}
      />
    </div>
  );
}
