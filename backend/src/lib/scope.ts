// Role + location scoping helpers.
// Auth identity: our own JWT (issued after ERPNext credential validation).
// Role + location enrichment: ERPNext User doctype (lst_location custom field + LST* roles).

import type { Context } from "hono";
import { verifyToken } from "./jwt";
import { readSessionToken } from "./session-cookie";
import type { UserRole } from "../types";

export interface AuthedUser {
  id: string;           // email (ERPNext user name)
  email: string;
  name: string;
  role: UserRole;
  locationId: string | null;          // alias for locationCode (kept for callers)
  locationCode: string | null;        // 'NYC' | 'HOU' | etc.
  canViewAllLocations: boolean;
}

// ─── ERPNext role → app role ───────────────────────────────────────────────────

function mapErpRole(roles: string[]): UserRole {
  if (roles.includes("LST Super Admin")) return "super_admin";
  if (roles.includes("LST Store Manager")) return "store_manager";
  if (roles.includes("LST Driver")) return "driver";
  if (roles.includes("LST Tailor")) return "tailor";
  if (roles.includes("LST Salesperson")) return "salesperson";
  // System Manager fallback for admins without explicit LST role
  if (roles.includes("System Manager")) return "super_admin";
  return "salesperson";
}

// ─── ERPNext user enrichment ──────────────────────────────────────────────────

interface ErpEnrichment {
  fullName: string | null;
  role: UserRole;
  locationCode: string | null;
  canViewAllLocations: boolean;
}

export async function enrichFromErp(email: string): Promise<ErpEnrichment> {
  const base = process.env.ERPNEXT_BASE_URL ?? "";
  const key  = process.env.ERPNEXT_API_KEY ?? "";
  const sec  = process.env.ERPNEXT_API_SECRET ?? "";

  const empty: ErpEnrichment = { fullName: null, role: "salesperson", locationCode: null, canViewAllLocations: false };
  if (!base || !key || !sec) return empty;

  const res = await fetch(
    `${base}/api/resource/User/${encodeURIComponent(email)}?fields=["full_name","lst_location","roles"]`,
    { headers: { Authorization: `token ${key}:${sec}`, Accept: "application/json" } },
  ).catch(() => null);

  if (!res?.ok) return empty;
  const json = await res.json().catch(() => ({})) as any;
  const data = json?.data;
  if (!data) return empty;

  const roleNames: string[] = (data.roles ?? []).map((r: any) => r.role as string);
  const role = mapErpRole(roleNames);

  return {
    fullName: data.full_name ?? null,
    role,
    locationCode: data.lst_location || null,
    canViewAllLocations: role === "super_admin",
  };
}

// ─── Main auth helper ─────────────────────────────────────────────────────────
// Validates our JWT (session cookie preferred, Bearer fallback) then enriches.

export async function getAuthedUser(c: Context): Promise<AuthedUser | null> {
  // Cookie (SSO across *.lstailors.com) first; Authorization: Bearer for API/tool callers
  const token = readSessionToken(c);
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const email = payload.sub;

  // Fast path: role + location embedded in JWT — no ERPNext call needed
  if (payload.role && payload.locationCode !== undefined) {
    const role = payload.role as UserRole;
    const locationCode = payload.locationCode || null;
    return {
      id: email,
      email,
      name: payload.name ?? email,
      role,
      locationId: locationCode,
      locationCode,
      canViewAllLocations: role === "super_admin",
    };
  }

  // Fallback: old tokens without embedded role — call ERPNext
  const enrichment = await enrichFromErp(email);

  return {
    id: email,
    email,
    name: enrichment.fullName ?? payload.name ?? email,
    role: enrichment.role,
    locationId: enrichment.locationCode,
    locationCode: enrichment.locationCode,
    canViewAllLocations: enrichment.canViewAllLocations,
  };
}

// ─── Location filter resolvers ────────────────────────────────────────────────

/** Super-admin may pass ?locationId= override; store roles use their locationCode. */
export function resolveScopedLocationId(
  user: AuthedUser,
  override?: string | null,
): string | null {
  if (user.role === "super_admin" || user.canViewAllLocations) {
    if (!override || override === "all" || override === "") return null;
    return override;
  }
  return user.locationCode;
}

export function resolveLocationCode(
  user: AuthedUser,
  override?: string | null,
): string | null {
  if (user.role === "super_admin" || user.canViewAllLocations) {
    return override && override !== "all" ? override : null;
  }
  return user.locationCode;
}

// Legacy alias kept so routes still compile without changes.
export function resolveLocationFilter(
  user: AuthedUser,
  override?: string | null,
): string | null {
  return resolveScopedLocationId(user, override);
}

// ─── Role predicates ──────────────────────────────────────────────────────────

export function canSeeFinancials(role: UserRole): boolean {
  return role === "super_admin" || role === "store_manager";
}

export function canAccessSuperAdminPortal(role: UserRole): boolean {
  return role === "super_admin";
}

export function canManageOrders(role: UserRole): boolean {
  return role === "super_admin" || role === "store_manager";
}

export function canReassignTailor(role: UserRole): boolean {
  return role === "super_admin" || role === "store_manager";
}

// ─── Row visibility predicates ────────────────────────────────────────────────

export function canReadAlteration(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string },
): boolean {
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  if (user.role === "driver") return false;
  const rowLoc = row.location_id ?? row.locationId;
  return rowLoc === user.locationCode;
}

export function canReadCustomOrder(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string; created_by?: string; createdById?: string },
): boolean {
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  if (user.role === "driver") return false;
  const rowLoc = row.location_id ?? row.locationId;
  if (rowLoc !== user.locationCode) return false;
  if (user.role === "salesperson") {
    const createdBy = row.created_by ?? row.createdById;
    return createdBy === user.id;
  }
  return true;
}

export function canWriteCustomOrder(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string; created_by?: string; createdById?: string },
): boolean {
  return canReadCustomOrder(user, row);
}

export function canReadDelivery(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string; driver_id?: string | null; driverId?: string | null },
): boolean {
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  if (user.role === "driver") return (row.driver_id ?? row.driverId) === user.id;
  return (row.location_id ?? row.locationId) === user.locationCode;
}

export function canWriteDelivery(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string; driver_id?: string | null; driverId?: string | null },
): boolean {
  if (user.role === "super_admin") return true;
  if (user.role === "driver") return (row.driver_id ?? row.driverId) === user.id;
  if (user.role === "store_manager") return (row.location_id ?? row.locationId) === user.locationCode;
  return false;
}

export function canReadCustomer(
  user: AuthedUser,
  row: { division?: string; locationId?: string },
): boolean {
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  if (user.role === "driver") return false;
  if (row.division && user.locationCode) return row.division === user.locationCode;
  return true;
}

export function canReadCommunication(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string },
): boolean {
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  if (user.role === "driver") return false;
  return (row.location_id ?? row.locationId) === user.locationCode;
}

export function canReadFinancialRow(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string },
): boolean {
  if (!canSeeFinancials(user.role)) return false;
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  return (row.location_id ?? row.locationId) === user.locationCode;
}
