# Agent git worktrees — ls-house-app (HER-60)

Canonical bare checkout (read-only preferred for `main`): `/Users/Maestro_1/ls-house-app`

**Rule:** every agent does all branch checkouts and file edits inside **its own worktree**. Never `git checkout` a feature branch in the canonical tree while other agents may be running.

| Agent | Worktree path | Branch seed |
|-------|---------------|-------------|
| marco | `/private/tmp/wt/marco` | `wt/marco` |
| maestro | `/private/tmp/wt/maestro` | `wt/maestro` |
| lucia | `/private/tmp/wt/lucia` | `wt/lucia` |
| simone | `/private/tmp/wt/simone` | `wt/simone` |
| melana | `/private/tmp/wt/melana` | `wt/melana` |
| rocco | `/private/tmp/wt/rocco` | `wt/rocco` |
| lapenna | `/private/tmp/wt/lapenna` | `wt/lapenna` |
| filo | `/private/tmp/wt/filo` | `wt/filo` |
| sofia | `/private/tmp/wt/sofia` | `wt/sofia` |
| mia | `/private/tmp/wt/mia` | `wt/mia` |
| pasquale | `/private/tmp/wt/pasquale` | `wt/pasquale` |
| parking (orphan drift) | `/private/tmp/wt/parking` | `parking/uncommitted-drift-2026-07-28` |
| legacy feature | `/private/tmp/wt/intake-persistence` | `feat/intake-persistence-clean` |

## How to start a task branch
```bash
cd /private/tmp/wt/<agent>
git fetch origin
git checkout -B audit/her-XX origin/main   # or fix/her-XX
# work only here
```

## Do NOT
- `git checkout` feature branches in `/Users/Maestro_1/ls-house-app` during multi-agent runs
- commit from the canonical tree without confirming no other agent is mid-run
- push/deploy unless the issue says so

## Orphan drift (parked 2026-07-29)
Copied (not deleted from canonical) into `/private/tmp/wt/parking`:
- `docs/print-formats/`
- `frappe/.../print_format/l_s_sales_invoice_pocket/`
- `frappe/wiki` submodule remains dirty in canonical — owner TBD (do not auto-commit)

Stashes in canonical repo (marco session): `marco-her52-temp`, `marco-her58-temp` — safe to drop after confirming empty of needed work.
