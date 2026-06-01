import { SectionHeader } from "@/components/glass/SectionHeader";
export default function Tasks() {
  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader eyebrow="L&S House · Ops" title={<span className="text-brass-shimmer">Tasks.</span>} description="Errands, pickups, internal jobs. Every open task in the house." />
      <div className="text-cream-muted text-sm text-center py-16 border border-dashed border-brass/15 rounded-2xl">Building task management — check back shortly.</div>
    </div>
  );
}
