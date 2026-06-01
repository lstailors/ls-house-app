import { SectionHeader } from "@/components/glass/SectionHeader";
export default function Comms() {
  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader eyebrow="L&S House · Intelligence" title={<span className="text-brass-shimmer">Intelligence Feed.</span>} description="Calls, recordings, messages — every signal in one place." />
      <div className="text-cream-muted text-sm text-center py-16 border border-dashed border-brass/15 rounded-2xl">Building intelligence feed — check back shortly.</div>
    </div>
  );
}
