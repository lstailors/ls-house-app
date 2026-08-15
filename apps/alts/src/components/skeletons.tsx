import { cn } from "@ls/design/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-brass/10 border border-brass/10", className)} />;
}

export function TileSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5" aria-busy="true" aria-label="Loading tiles">
      {Array.from({ length: count }, (_, i) => (
        <Bone key={i} className="h-[7.5rem]" />
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading list">
      {Array.from({ length: rows }, (_, i) => (
        <Bone key={i} className="h-20" />
      ))}
    </div>
  );
}

export function KanbanSkeleton({ cols = 3 }: { cols?: number }) {
  return (
    <div className="flex gap-3 overflow-x-auto" aria-busy="true" aria-label="Loading board">
      {Array.from({ length: cols }, (_, c) => (
        <div key={c} className="min-w-[240px] flex-1 space-y-2">
          <Bone className="h-8 w-28" />
          <Bone className="h-24" />
          <Bone className="h-24" />
          <Bone className="h-16" />
        </div>
      ))}
    </div>
  );
}
