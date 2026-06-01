import { GraduationCap } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";

export default function Academy() {
  return (
    <div className="space-y-8 animate-fade-up">
      <SectionHeader
        eyebrow="Learn"
        title="L&S Academy"
        description="A library of techniques, fabric stories, and the L&S way — coming soon."
      />
      <GlassCard variant="strong" className="p-16 flex flex-col items-center text-center">
        <div className="h-20 w-20 rounded-full border border-brass/30 bg-brass/10 flex items-center justify-center mb-6">
          <GraduationCap className="h-9 w-9 text-brass-light" />
        </div>
        <div className="display-heading text-3xl mb-2">Coming Soon</div>
        <p className="text-cream-muted max-w-md">
          A masterclass series for the L&amp;S team: from fabric provenance to fitting craft,
          from customer ritual to the language of bespoke.
        </p>
      </GlassCard>
    </div>
  );
}
