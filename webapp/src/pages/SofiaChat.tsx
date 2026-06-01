import { SectionHeader } from "@/components/glass/SectionHeader";
export default function SofiaChat() {
  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader eyebrow="L&S House · Sofia" title={<span className="text-brass-shimmer">Sofia — SMS.</span>} description="Every client conversation, both sides." />
      <div className="text-cream-muted text-sm text-center py-16 border border-dashed border-brass/15 rounded-2xl">Building Sofia SMS chat — check back shortly.</div>
    </div>
  );
}
