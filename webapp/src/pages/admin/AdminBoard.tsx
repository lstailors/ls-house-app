import { SectionHeader } from "@/components/glass/SectionHeader";
import { AlterationsBoard } from "@/components/alterations/AlterationsBoard";

export default function AdminBoard() {
  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Admin · Board"
        title={
          <>
            Alterations <span className="text-brass-shimmer">in progress</span>
          </>
        }
        description="Real-time view of all alterations with status, blockers, and timeline."
      />

      <AlterationsBoard />
    </div>
  );
}
