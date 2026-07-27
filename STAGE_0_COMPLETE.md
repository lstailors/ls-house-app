# Stage 0 complete — 2026-07-26

## Product split (C locked)
- **alts.lstailors.com** — intake + day-to-day orders  
- **app.lstailors.com** — dashboard / admin (+ shared API through Stage 5)

## What shipped

### Packages (`packages/*`)
| Package | Contents |
|---|---|
| `@ls/types` | Zod API contracts (from `backend/src/types.ts`) |
| `@ls/erp-client` | ERP REST + `erpnext/*` modules — **only ERP path** |
| `@ls/auth` | JWT, scope predicates, authClient, session |
| `@ls/api-client` | Browser fetch wrapper |
| `@ls/design` | Liquid Glass tokens, glass/*, CSS, tailwind preset |

Root **bun workspaces**: `packages/*`, `backend`, `webapp`, `apps/*`.

### Compatibility shims (no import rewrite required yet)
- `backend/src/types.ts`, `lib/erp.ts`, `lib/jwt.ts`, `lib/scope.ts`, `lib/erpnext/*` → re-export packages  
- `webapp/src/lib/{types,api,authClient,session}.ts` → packages  
- `webapp/src/lib/scope.ts` → `@ls/auth` predicates + UI `canAccessMissionControl`

### Other Stage 0 items
- **CORS:** `alts.lstailors.com` on both `app.ts` and `index.ts`
- **Prod mounts (D16):** `/api/qr`, `/api/square`, `/api/files`, `/api/outreach`, `/api/erpnext-customers` on `app.ts`
- **Dead UI removed:** `AlterationDetail.tsx`, `GarmentTag.tsx`, `Placeholder.tsx`
- **apps/alts** workspace stub only (Stage 1 scaffold next)

## Verify
| Check | Result |
|---|---|
| `cd webapp && bun run build` | **green** |
| `bun` load `backend/src/app.ts` + `/health` | **200 ok** |
| `GET /api/qr?data=test` | **200** (mounted) |
| `tsc --noEmit` backend | Runs; pre-existing strict errors in sofia/locations/etc. (not introduced by package move). Package jwt has 2 strict nits. |

## Behavior notes
- UI still runs on **app.** only — no route strip yet  
- Staff token still **localStorage** (cookie SSO = Stage 1)  
- D2: webapp financials visibility now uses backend `canSeeFinancials` (**store_manager** included) via `@ls/auth`  
- No Supabase writes added  

## Not done (later stages)
- Stage 1: real alts Vite app + login + tile home  
- Cookie session on `.lstailors.com`  
- Move ticketing UI  

## Rollback
Revert the Stage 0 commit / discard package tree and restore `backend/src/lib/*` from git HEAD. Shims make partial rollback possible by pointing imports back.

**Stop — awaiting go for Stage 1.**
