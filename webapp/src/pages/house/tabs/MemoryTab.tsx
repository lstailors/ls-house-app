import { useState } from "react";
import { Plus, Pencil, User, Brain, Sparkles, Tag } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  USER_PROFILE, MEMORY_NOTES, SKILLS, type HouseSkill,
} from "../mockData";
import { SkeletonRows, useFakeLoading, comingSoon } from "../components/shared";

function MemoryCard({ text }: { text: string }) {
  return (
    <div className="glass-panel rounded-xl p-3.5 border border-brass/10 flex items-start gap-3 group hover:border-brass/25 transition-colors">
      <p className="flex-1 text-sm text-cream-muted leading-snug">{text}</p>
      <button
        onClick={comingSoon}
        className="text-cream-dim/50 hover:text-brass-light transition-colors shrink-0 mt-0.5"
        aria-label="Edit memory"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function MemoryPanel({ title, icon, items }: { title: string; subtitle?: string; icon: React.ReactNode; items: string[] }) {
  return (
    <div className="glass-panel-strong rounded-2xl p-5 border border-brass/15">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <span className="ui-label text-[10px] tracking-widest">{title}</span>
      </div>
      <div className="space-y-2">
        {items.map((t, i) => <MemoryCard key={i} text={t} />)}
      </div>
    </div>
  );
}

function SkillCard({ skill, onView }: { skill: HouseSkill; onView: () => void }) {
  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-4 border border-brass/10 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-sm text-cream truncate">{skill.name}</span>
        <span className="px-1.5 py-0.5 rounded text-[8px] font-medium uppercase tracking-wider border border-brass/20 text-brass-light bg-brass/5 shrink-0">
          {skill.version}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-cream-dim">
        <Tag className="h-2.5 w-2.5" /> {skill.category}
      </div>
      <div className="mt-1 text-[10px] text-cream-dim/70">Last used: {skill.lastUsed}</div>
      <Button
        size="sm"
        variant="outline"
        onClick={onView}
        className="mt-4 w-full h-8 text-xs border-brass/20 text-cream hover:bg-brass/10 hover:text-cream"
      >
        View
      </Button>
    </div>
  );
}

function SkillDialog({ skill, onClose }: { skill: HouseSkill | null; onClose: () => void }) {
  return (
    <Dialog open={!!skill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-forest-deep/95 backdrop-blur-2xl border border-brass/20 text-cream max-w-md">
        {skill ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono text-lg text-cream">{skill.name}</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] border border-brass/20 text-brass-light bg-brass/5">{skill.category}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] border border-brass/20 text-cream-muted bg-cream/5">{skill.version}</span>
              <span className="text-[10px] text-cream-dim">Last used: {skill.lastUsed}</span>
            </div>
            <p className="text-sm text-cream-muted leading-relaxed mt-2">{skill.description}</p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function MemoryTab() {
  const loading = useFakeLoading();
  const [selectedSkill, setSelectedSkill] = useState<HouseSkill | null>(null);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonRows count={5} h="h-12" />
          <SkeletonRows count={5} h="h-12" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add memory */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">MEMORY</span>
        </div>
        <Button size="sm" onClick={comingSoon} className="btn-brass h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Memory
        </Button>
      </div>

      {/* Two-panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MemoryPanel
          title="USER PROFILE · WHO C IS"
          icon={<User className="h-3.5 w-3.5 text-brass-light" />}
          items={USER_PROFILE}
        />
        <MemoryPanel
          title="MEMORY NOTES · WHAT MAESTRO KNOWS"
          icon={<Brain className="h-3.5 w-3.5 text-signal-emerald/70" />}
          items={MEMORY_NOTES}
        />
      </div>

      {/* Skills */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">SKILLS</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SKILLS.map((s) => (
            <SkillCard key={s.name} skill={s} onView={() => setSelectedSkill(s)} />
          ))}
        </div>
      </div>

      <SkillDialog skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
    </div>
  );
}
