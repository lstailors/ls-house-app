import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { Construction } from "lucide-react";

interface Props {
  title: string;
  eyebrow?: string;
  description?: string;
}

export default function Placeholder({ title, eyebrow, description }: Props) {
  return (
    <div className="space-y-8 animate-fade-up">
      <SectionHeader eyebrow={eyebrow} title={title} description={description} />
      <GlassCard className="p-16 flex flex-col items-center text-center">
        <Construction className="h-10 w-10 text-brass-light/60 mb-4" />
        <div className="display-heading text-2xl mb-2">Module under construction</div>
        <div className="text-sm text-cream-muted max-w-sm">
          This screen is part of the L&amp;S House blueprint. The full implementation is being staged.
        </div>
      </GlassCard>
    </div>
  );
}
