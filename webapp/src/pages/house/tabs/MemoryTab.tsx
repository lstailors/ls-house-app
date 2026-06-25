import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, User, Brain, Sparkles, Tag, Check, X, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { SkeletonRows } from "../components/shared";
import { toast } from "sonner";

interface MemoryData {
  memory: string[];
  user_profile: string[];
  skills: { name: string; category: string }[];
}

function EditableMemoryCard({
  text,
  onSave,
  saving,
}: {
  text: string;
  onSave: (updated: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const handleSave = () => {
    if (draft.trim() && draft !== text) onSave(draft.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="glass-panel rounded-xl p-3 border border-brass/30 flex flex-col gap-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); } if (e.key === "Escape") setEditing(false); }}
          className="w-full text-sm bg-transparent text-cream leading-snug resize-none focus:outline-none min-h-[40px]"
          rows={2}
        />
        <div className="flex gap-1.5 justify-end">
          <button onClick={() => setEditing(false)} className="text-cream-dim/50 hover:text-signal-rose transition-colors" disabled={saving}>
            <X className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleSave} className="text-cream-dim/50 hover:text-signal-emerald transition-colors" disabled={saving}>
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl p-3.5 border border-brass/10 flex items-start gap-3 group hover:border-brass/25 transition-colors">
      <p className="flex-1 text-sm text-cream-muted leading-snug">{text}</p>
      <button
        onClick={() => { setDraft(text); setEditing(true); }}
        className="text-cream-dim/50 hover:text-brass-light transition-colors shrink-0 mt-0.5"
        aria-label="Edit memory"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AddMemoryRow({ target, onAdd }: { target: "memory" | "user"; onAdd: (t: "memory" | "user", text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const handleAdd = () => {
    if (!text.trim()) return;
    onAdd(target, text.trim());
    setText("");
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="glass-panel rounded-xl p-3 border border-brass/25 flex flex-col gap-2">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); } if (e.key === "Escape") setOpen(false); }}
        placeholder="New entry…"
        className="w-full text-sm bg-transparent text-cream placeholder:text-cream-dim leading-snug resize-none focus:outline-none min-h-[40px]"
        rows={2}
      />
      <div className="flex gap-1.5 justify-end">
        <button onClick={() => setOpen(false)} className="text-cream-dim/50 hover:text-signal-rose transition-colors"><X className="h-3.5 w-3.5" /></button>
        <button onClick={handleAdd} className="text-cream-dim/50 hover:text-signal-emerald transition-colors"><Check className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

interface SkillCardProps {
  skill: { name: string; category: string };
  onView: () => void;
}

function SkillCard({ skill, onView }: SkillCardProps) {
  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-4 border border-brass/10 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-sm text-cream truncate">{skill.name}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-cream-dim">
        <Tag className="h-2.5 w-2.5" /> {skill.category || "General"}
      </div>
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

function SkillDialog({ skill, onClose }: { skill: { name: string; category: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!skill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-forest-deep/95 backdrop-blur-2xl border border-brass/20 text-cream max-w-md">
        {skill ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono text-lg text-cream">{skill.name}</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] border border-brass/20 text-brass-light bg-brass/5">{skill.category || "General"}</span>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MemoryPanel({
  title,
  icon,
  items,
  target,
  onUpdate,
  onAdd,
  saving,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  target: "memory" | "user";
  onUpdate: (t: "memory" | "user", idx: number, text: string) => void;
  onAdd: (t: "memory" | "user", text: string) => void;
  saving: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="glass-panel-strong rounded-2xl p-5 border border-brass/15">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <span className="ui-label text-[10px] tracking-widest">{title}</span>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="ml-auto text-brass-light/60 hover:text-brass-light transition-colors"
          title="Add entry"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2">
        {items.map((t, i) => (
          <EditableMemoryCard
            key={i}
            text={t}
            onSave={(updated) => onUpdate(target, i, updated)}
            saving={saving}
          />
        ))}
        {showAdd ? (
          <AddMemoryRow
            target={target}
            onAdd={(tgt, text) => {
              onAdd(tgt, text);
              setShowAdd(false);
            }}
          />
        ) : null}
        {items.length === 0 && !showAdd ? (
          <p className="text-[11px] text-cream-dim/60 text-center py-3">No entries yet.</p>
        ) : null}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass-panel rounded-2xl p-8 border border-brass/10 flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-cream-dim">Could not load memory data.</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="border-brass/20 text-cream hover:bg-brass/10 hover:text-cream">
        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
      </Button>
    </div>
  );
}

export default function MemoryTab() {
  const qc = useQueryClient();
  const [selectedSkill, setSelectedSkill] = useState<{ name: string; category: string } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["house-memory"],
    queryFn: () => api.get<MemoryData>("/api/house/memory"),
    staleTime: 60_000,
  });

  const patchMutation = useMutation({
    mutationFn: (payload: { target: "memory" | "user"; content: string }) =>
      api.patch<{ ok: boolean }>("/api/house/memory", payload),
    onError: () => toast.error("Failed to save memory"),
  });

  const memory: string[] = data?.memory ?? [];
  const userProfile: string[] = data?.user_profile ?? [];
  const skills: { name: string; category: string }[] = data?.skills ?? [];

  const handleUpdate = (target: "memory" | "user", idx: number, text: string) => {
    const arr = target === "memory" ? [...memory] : [...userProfile];
    arr[idx] = text;
    const content = arr.join(" § ");
    patchMutation.mutate({ target, content });

    qc.setQueryData(["house-memory"], (old: any) => ({
      ...old,
      [target === "memory" ? "memory" : "user_profile"]: arr,
    }));
  };

  const handleAdd = (target: "memory" | "user", text: string) => {
    const arr = target === "memory" ? [...memory, text] : [...userProfile, text];
    const content = arr.join(" § ");
    patchMutation.mutate({ target, content });

    qc.setQueryData(["house-memory"], (old: any) => ({
      ...old,
      [target === "memory" ? "memory" : "user_profile"]: arr,
    }));
    toast.success("Entry added");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonRows count={5} h="h-12" />
          <SkeletonRows count={5} h="h-12" />
        </div>
      </div>
    );
  }

  if (isError) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-brass-light" />
          <span className="ui-label text-[10px] tracking-widest">MEMORY</span>
        </div>
      </div>

      {/* Two-panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MemoryPanel
          title="USER PROFILE · WHO C IS"
          icon={<User className="h-3.5 w-3.5 text-brass-light" />}
          items={userProfile}
          target="user"
          onUpdate={handleUpdate}
          onAdd={handleAdd}
          saving={patchMutation.isPending}
        />
        <MemoryPanel
          title="MEMORY NOTES · WHAT MAESTRO KNOWS"
          icon={<Brain className="h-3.5 w-3.5 text-signal-emerald/70" />}
          items={memory}
          target="memory"
          onUpdate={handleUpdate}
          onAdd={handleAdd}
          saving={patchMutation.isPending}
        />
      </div>

      {/* Skills */}
      {skills.length > 0 ? (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-3.5 w-3.5 text-brass-light" />
            <span className="ui-label text-[10px] tracking-widest">SKILLS</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {skills.map((s) => (
              <SkillCard key={s.name} skill={s} onView={() => setSelectedSkill(s)} />
            ))}
          </div>
        </div>
      ) : null}

      <SkillDialog skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
    </div>
  );
}
