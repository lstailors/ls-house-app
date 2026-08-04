# SPEC 072 — Final audit (Desktop ↔ MC)

**Date:** 2026-08-04 · **Auditor:** Simone  
**Prod tip:** `4b8296c` (#92) · Vercel Production **Ready**  
**MC:** https://app.lstailors.com/mission-control?tab=hermes  
**Console:** https://maestro.lstailors.com → Studio `:9119`

## Verdict

| Question | Answer |
|---|---|
| Is there more to **this** build (SPEC 072)? | **No.** Phases 1–3 + hardeners shipped. Operator mirror is complete. |
| Did we take all we **need** from Desktop? | **Yes for ops control-plane.** No for full Electron clone. |
| All wired + tested? | **Backend Studio APIs verified live with auth.** MC routes require staff login (401 unauth = correct). |
| Match Desktop 1:1? | **Not the goal.** Two surfaces, one Studio brain. Enhance MC only where staff gain is real. |

## Live probe (maestro, dashboard login OK)

| API | Status | Notes |
|---|---|---|
| `/api/status` | 200 public | gateway + auth_providers |
| `/api/sessions` | 200 | list + total |
| `/api/sessions/stats` | 200 | by_source |
| `/api/skills` | 200 | 120 skills |
| `/api/cron/jobs` | 200 | 61 jobs |
| `/api/mcp/servers` | 200 | (proxy path; bare `/api/mcp` 404) |
| `/api/memory` | 200 | providers + builtin_files |
| `/api/analytics/usage` | 200 | daily/by_model/totals |
| `/api/analytics/models` | 200 | models + totals |
| `/api/config` | 200 | model/providers (deep-link only in MC) |
| `/api/files` | 200 | **Desktop-only by design** |
| `/api/git/*` | 422 without cwd | **Desktop-only** |
| `/api/learning/graph` | 200 | graph data available; MC not rendering canvas |
| `/api/profiles/sessions` | 200 | multi-profile |
| `/api/model/info` | 200 | |
| local `:9119` | 200 | |
| MC `/hermes/*` unauth | **401** | RoleGuard — login first |

Credentials: Keychain + Vercel prod `HERMES_DASHBOARD_*` set. Edge client is env-only (no `child_process`).

## Parity matrix

| Desktop / Dashboard capability | MC surface | Mode | Wired | Tested |
|---|---|---|---|---|
| Gateway / agent status | Hermes → Overview | mirror | ✅ | ✅ status 200 |
| Open full Console | Open Console / Live Chat | deep-link | ✅ | ✅ maestro tunnel |
| Sessions list | Hermes → Sessions | mirror | ✅ | ✅ API + UI |
| Session transcript | Sessions click-through | mirror | ✅ | ✅ messages route |
| Live streaming chat + tool cards | Live Chat deep-link / Desktop | deep-link | ✅ open | ⚠ not embedded WS |
| Fleet one-shot command | Hermes → Chat (mc_commands) | MC-native | ✅ | queue path |
| Skills browse | Hermes → Skills | mirror (read) | ✅ | ✅ 120 skills |
| Skills install/toggle | Console / Desktop | deep-link | — | — |
| Cron list / health | Hermes Cron + Crons tab | mirror (read) + MC health | ✅ | ✅ 61 jobs |
| Cron create/edit/pause/trigger UI | Console Cron | deep-link | list only in MC | API exists on Studio |
| Usage / models | Hermes Usage + Costs strip | mirror | ✅ | ✅ analytics 200 |
| Memory providers + MEMORY.md sizes | Hermes → Memory | mirror | ✅ | ✅ memory 200 |
| Memory knowledge-graph canvas | Console System | deep-link | data exists | UI not in MC |
| MCP servers list | Hermes → Admin | mirror | ✅ | path `/api/mcp/servers` |
| MCP install/test | Console | deep-link | — | — |
| Channels / pairing | Admin deep-links | deep-link | links | gateway from status |
| Config / models / keys | Console Config | deep-link | — | secrets stay Studio |
| Artifacts gallery | Hermes → Artifacts | MC from activity/commands | ✅ | activity-backed |
| Multi-profile sessions | deep-link Profiles + status | partial | profiles API live | no full switcher UI |
| File browser | Desktop | desktop-only | API live | out of scope |
| Terminal / PTY | Desktop | desktop-only | — | out of scope |
| Git review / worktrees | Desktop | desktop-only | — | out of scope |
| Voice / Quick Entry / themes | Desktop | desktop-only | — | out of scope |
| Remote Desktop → Studio | Desktop Settings → maestro | ops path | ✅ | tunnel live |
| Fleet · Board · Approvals · Alerts | MC native | MC-native | ✅ | house product |

## Architecture (locked)

```
app.lstailors.com/mission-control  =  L&S fleet + ERP ops shell
maestro.lstailors.com (:9119)      =  Hermes operator runtime SoT
Hermes Desktop                     =  native shell on same Studio brain
```

Do **not** point Desktop at MC as backend.  
Do **not** put dashboard password in the browser.  
Mutations that must be staff-safe stay on `lsh.mc_commands` drained on Studio.

## What “enhance MC to match Desktop” still means (optional Phase 4+)

Only if C wants deeper parity — **not required for SPEC 072 close**:

1. **Cron drawer** — create/edit/pause/trigger via `/api/cron/*` proxy (mutations gated super_admin)
2. **Session search** — `/api/sessions/search` in Hermes Sessions
3. **Learning graph viz** — render `/api/learning/graph` (read-only)
4. **Multi-profile switcher** — filter sessions by profile
5. **Skills toggle** — enable/disable skill (careful; Studio side-effects)
6. **Embedded live chat** — WS proxy to `/api/ws` or `/api/pty` (hardest; auth + Edge limits)

**Never port to MC (keep Desktop):** files, terminal, git/worktrees, voice, YOLO tool approval UX, full settings/secrets editor.

## Parallel product gaps (not Desktop mirror)

- Approvals SPEC 067
- Agent Control SPEC 068  
- Real heartbeats (honest Agent Control)
- Tab consolidate (Crons/Schedule, Live/History)

## Sign-off checklist

- [x] P1 shell + deep links (#87)
- [x] P2 chat/admin/artifacts (#88)
- [x] P3 memory/transcripts/usage (#90)
- [x] Edge typecheck + no node:child_process (#91)
- [x] Login harden + Costs token feed (#92)
- [x] Dashboard auth Keychain + Vercel prod
- [x] maestro APIs verified post-auth
- [x] Prod deploy Ready
- [ ] C smoke: login → Hermes tabs populate after hard refresh (human)

## Bottom line

**We took what ops needs from Desktop into app.lstailors.**  
Full Desktop remains the power tool for files/git/terminal/live TUI.  
SPEC 072 is **done**. Further work is enhancement backlog, not unfinished mirror.
