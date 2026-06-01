import { SectionHeader } from "@/components/glass/SectionHeader";
export default function Customers() {
  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader eyebrow="L&S House · Clients" title={<span className="text-brass-shimmer">Clients.</span>} description="Every gentleman in the house." />
      <div className="text-cream-muted text-sm text-center py-16 border border-dashed border-brass/15 rounded-2xl">Building client directory — check back shortly.</div>
    </div>
  );
}
