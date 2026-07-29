import { useQuery } from "@tanstack/react-query";
import { SectionHeader } from "@ls/design";
import { AlterationsBoard, type AlterationRow } from "@alts/components/alterations/AlterationsBoard";
import { api } from "@ls/api-client";

export default function AdminBoard() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["alterations-board"],
    queryFn: () => api.get<AlterationRow[]>("/api/alterations-board"),
    refetchInterval: 60_000,
  });

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
      {isLoading ? (
        <div className="text-cream-muted text-sm py-8 text-center">Loading board…</div>
      ) : (
        <AlterationsBoard rows={rows} />
      )}
    </div>
  );
}
