import { useState } from "react";
import { Plus, Check, Pencil, Cpu, Calendar } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@ls/design/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@ls/design/ui/select";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import {
  PROFILES, MODEL_OPTIONS, PROVIDER_OPTIONS, SKILL_OPTIONS, type HouseProfile,
} from "../mockData";
import { SkeletonGrid, useFakeLoading, comingSoon } from "../components/shared";

function ProfileCard({ profile }: { profile: HouseProfile }) {
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
        <div className="flex items-center justify-between text-xs">
          <span className="ui-label text-[9px]">Created</span>
          <span className="text-[11px] text-cream-dim flex items-center gap-1">
            <Calendar className="h-2.5 w-2.5" /> {profile.created}
          </span>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <Button
          size="sm"
          onClick={comingSoon}
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
          onClick={comingSoon}
          className="h-8 text-xs border-brass/20 text-cream hover:bg-brass/10 hover:text-cream"
        >
          <Pencil className="h-3 w-3 mr-1" /> Edit
        </Button>
      </div>
    </div>
  );
}

function NewProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [provider, setProvider] = useState(PROVIDER_OPTIONS[0]);
  const [skills, setSkills] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const toggleSkill = (s: string) =>
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleCreate = () => {
    comingSoon();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-forest-deep/95 backdrop-blur-2xl border border-brass/20 text-cream max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl text-cream font-medium">New Profile</DialogTitle>
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
          <Button onClick={handleCreate} className="btn-brass">
            Create Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProfilesTab() {
  const loading = useFakeLoading();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">HERMES PROFILES</span>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="btn-brass h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> New Profile
        </Button>
      </div>

      {loading ? (
        <SkeletonGrid count={3} h="h-56" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PROFILES.map((p) => (
            <ProfileCard key={p.id} profile={p} />
          ))}
        </div>
      )}

      <NewProfileDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
