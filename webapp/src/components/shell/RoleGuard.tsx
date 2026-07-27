import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useMe } from "@/lib/session";
import type { UserRole } from "@ls/types";
import { Monogram } from "@ls/design";

interface Props {
  allow: UserRole[];
  children: ReactNode;
  fallback?: string;
}

export function RoleGuard({ allow, children, fallback = "/" }: Props) {
  const { data: user, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Monogram size="lg" className="animate-glow-pulse" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (!allow.includes(user.role)) {
    return <Navigate to={fallback} replace />;
  }
  return <>{children}</>;
}
