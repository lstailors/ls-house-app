/** Re-export backend-canonical role predicates (audit D2). */
export {
  canSeeFinancials,
  canAccessSuperAdminPortal,
  canManageOrders,
  type AuthedUser,
} from "@ls/auth/scope";
export type { UserRole } from "@ls/types";

/** UI helper: mission control for managers+ */
export function canAccessMissionControl(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "store_manager";
}
