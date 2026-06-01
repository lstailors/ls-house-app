// Role + location scoping helpers.
// Auth identity: Supabase Auth JWT (Bearer token from Authorization header).
// Profile + location enrichment: public.profiles + public.locations (service role).
// lsh table filtering uses supabaseLocationId (UUID from public.locations).
// public.customers filtering uses locationCode (division column, text).

import type { Context } from "hono";
import { supabaseAdmin } from "./supabase";
import type { UserRole } from "../types";

export interface AuthedUser {
  id: string;                         // Supabase auth.users.id (UUID)
  email: string;
  name: string;
  role: UserRole;
  locationId: string | null;          // alias for supabaseLocationId (kept for callers)
  supabaseProfileId: string | null;   // public.profiles.id (UUID) — same as id
  supabaseLocationId: string | null;  // public.locations.id (UUID) for lsh.* filter
  locationCode: string | null;        // 'NYC'|'HOU' for public.customers.division filter
  canViewAllLocations: boolean;
}

// ─── Role mapping ─────────────────────────────────────────────────────────────

const VALID_ROLES: readonly UserRole[] = ["super_admin", "store_manager", "salesperson", "driver"];

function mapRole(profile: any): UserRole {
  const raw: string = profile?.lsh_role ?? profile?.role ?? "";
  // Normalise profiles.role='manager' → 'store_manager' (belt-and-suspenders for future rows)
  const normalized = raw === "manager" ? "store_manager" : raw;
  return (VALID_ROLES as string[]).includes(normalized) ? (normalized as UserRole) : "salesperson";
}

// ─── Supabase profile enrichment ──────────────────────────────────────────────

interface SupabaseEnrichment {
  supabaseProfileId: string | null;
  supabaseLocationId: string | null;
  locationCode: string | null;
  canViewAllLocations: boolean;
  fullName: string | null;
  role: UserRole;
}

async function enrichFromSupabase(userId: string, email: string): Promise<SupabaseEnrichment> {
  const empty: SupabaseEnrichment = {
    supabaseProfileId: userId,
    supabaseLocationId: null,
    locationCode: null,
    canViewAllLocations: false,
    fullName: null,
    role: "salesperson",
  };
  if (!supabaseAdmin) return empty;

  // profiles.id = auth.users.id, so look up by id first; fall back to email
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, home_location, can_view_all_locations, role, lsh_role")
    .or(`id.eq.${userId},email.eq.${email}`)
    .single();

  if (!profile) return empty;

  const enrichment: SupabaseEnrichment = {
    supabaseProfileId: profile.id ?? userId,
    supabaseLocationId: null,
    locationCode: profile.home_location ?? null,
    canViewAllLocations: profile.can_view_all_locations ?? false,
    fullName: profile.full_name ?? null,
    role: mapRole(profile),
  };

  if (profile.home_location) {
    const { data: loc } = await supabaseAdmin
      .from("locations")
      .select("id")
      .eq("code", profile.home_location)
      .single();
    enrichment.supabaseLocationId = loc?.id ?? null;
  }

  return enrichment;
}

// ─── Main auth helper ─────────────────────────────────────────────────────────
// Validates Supabase JWT from Authorization: Bearer <token> header.

export async function getAuthedUser(c: Context): Promise<AuthedUser | null> {
  if (!supabaseAdmin) return null;

  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user || !user.email) return null;

  const enrichment = await enrichFromSupabase(user.id, user.email);

  const resolved: AuthedUser = {
    id: user.id,
    email: user.email,
    name: enrichment.fullName ?? user.email,
    role: enrichment.role,
    locationId: enrichment.supabaseLocationId,
    supabaseProfileId: enrichment.supabaseProfileId,
    supabaseLocationId: enrichment.supabaseLocationId,
    locationCode: enrichment.locationCode,
    canViewAllLocations: enrichment.canViewAllLocations,
  };

  return resolved;
}

// ─── Location filter resolvers ────────────────────────────────────────────────

export function resolveSupabaseLocationId(
  user: AuthedUser,
  override?: string | null,
): string | null {
  if (user.role === "super_admin" || user.canViewAllLocations) {
    if (!override || override === "all" || override === "") return null;
    return override;
  }
  return user.supabaseLocationId;
}

export function resolveLocationCode(
  user: AuthedUser,
  override?: string | null,
): string | null {
  if (user.role === "super_admin" || user.canViewAllLocations) {
    return null;
  }
  return user.locationCode;
}

// Legacy alias kept so routes still compile without changes.
export function resolveLocationFilter(
  user: AuthedUser,
  override?: string | null,
): string | null {
  return resolveSupabaseLocationId(user, override);
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
  return rowLoc === user.supabaseLocationId;
}

export function canReadCustomOrder(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string; created_by?: string; createdById?: string },
): boolean {
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  if (user.role === "driver") return false;
  const rowLoc = row.location_id ?? row.locationId;
  if (rowLoc !== user.supabaseLocationId) return false;
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
  return (row.location_id ?? row.locationId) === user.supabaseLocationId;
}

export function canWriteDelivery(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string; driver_id?: string | null; driverId?: string | null },
): boolean {
  if (user.role === "super_admin") return true;
  if (user.role === "driver") return (row.driver_id ?? row.driverId) === user.id;
  if (user.role === "store_manager") return (row.location_id ?? row.locationId) === user.supabaseLocationId;
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
  return (row.location_id ?? row.locationId) === user.supabaseLocationId;
}

export function canReadFinancialRow(
  user: AuthedUser,
  row: { location_id?: string; locationId?: string },
): boolean {
  if (!canSeeFinancials(user.role)) return false;
  if (user.role === "super_admin" || user.canViewAllLocations) return true;
  return (row.location_id ?? row.locationId) === user.supabaseLocationId;
}
