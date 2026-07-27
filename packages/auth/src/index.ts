// @ls/auth — single source of truth for identity, JWT, and role predicates.
//
// Stage 0 (audit D2): webapp/src/lib/scope.ts was a DIVERGENT copy of the role
// predicates — it gated financials on super_admin only, while the backend (the
// actual enforcer) allows store_manager. That copy was deleted; this is now the
// only definition. Both apps import from here.
export * from "./jwt";
export * from "./scope";
export * from "./authClient";
export * from "./session";
