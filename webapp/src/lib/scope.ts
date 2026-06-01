// Permission helpers — role-based visibility guards.

export type UserRole = "super_admin" | "store_manager" | "salesperson" | "tailor" | string;

/** Only super_admin can see financial data (PnL, COGS, margins). */
export function canSeeFinancials(role: UserRole | null | undefined): boolean {
  return role === "super_admin";
}

/** super_admin or store_manager can access mission control. */
export function canAccessMissionControl(role: UserRole | null | undefined): boolean {
  return role === "super_admin" || role === "store_manager";
}
