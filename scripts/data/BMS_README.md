# Customer Body Measurement Master (BMS)

## Model

| Layer | Where | Role |
|---|---|---|
| **Master** | `Body Measurement Set` + `Body Measurement Detail` | Versioned customer body block (`Draft` → `Current` → `Superseded`) |
| **Catalog** | `Measurement Type` (97 codes) | Canonical codes + buckets (`Skin` / `Finished` / …) |
| **Per order** | `MTMPro Order.fit_notes` + `body_measurement_set` link | Order snapshot stays on order; link points at BMS used |
| **SO** | `Sales Order.mtmpro_order` | Resolve measures via MTMPro |
| **FOH cache** | Customer `lsh_chest` / `lsh_seat` / `lsh_back_length` / `lsh_outseam` | Optional denormalized chips (not SoT) |

Portal `my.lstailors.com/measure` already reads Current/Draft BMS.

## Promote script

```bash
# Dry-run all MTMPro with fit_notes
python3 ~/ls-house-app/scripts/promote_mtmpro_bms.py --dry-run --all

# Write Draft BMS + link orders (safe review status)
python3 ~/ls-house-app/scripts/promote_mtmpro_bms.py --write --all --status Draft

# One order → Current master (supersedes prior Current) + Customer lsh_* cache
python3 ~/ls-house-app/scripts/promote_mtmpro_bms.py --write --status Current --order LST-122512-1

# Skip already-linked orders is default; force re-promote:
python3 ~/ls-house-app/scripts/promote_mtmpro_bms.py --write --all --status Draft --include-linked
```

Files:

- `scripts/promote_mtmpro_bms.py` — parser + promote
- `scripts/data/measurement_type_aliases.json` — MTMPro label → type map
- `scripts/data/bms_promote_dry.json` / `bms_promote_write.json` — last reports

Env: `~/ls-mcp/.env` (`ERPNEXT_URL`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`).

## Rules

1. **Master = body/skin** (neck, chest, seat, overarm, wrists, rises, outseams, coat back, PTP, sleeves when captured as body).
2. **Finished garment specs** (½ knee, cuff width, yoke fin, etc.) stay on the **order** `fit_notes` — not customer master.
3. New fitting → new BMS version; old `Current` → `Superseded`.
4. Multiple orders per client currently create multiple Drafts (one per order). To promote one master per client: pick latest full set → `--status Current`.

## 2026-08-03 backfill

### Pass 1 — Draft promote from MTMPro fit_notes
- 68 MTMPro with `fit_notes`
- **62 Draft BMS** created + order linked (then collapsed)
- Parser: `promote_mtmpro_bms.py`

### Pass 2 — Current master + Customer cache
```bash
python3 ~/ls-house-app/scripts/backfill_bms_current.py --write
# optional first: --promote-unlinked
```
- **1 Current BMS per customer** (fullest wins; rest Superseded)
- Customer `lsh_chest` / `lsh_seat` / `lsh_back_length` / `lsh_outseam` mirrored (inches)
- Extra order recovered: `LST-122478-2` Jonhnny Livanos (comma Skin line)

### Still unlinked (no tape in fit_notes)
- Gene Norden — posture analysis only
- Brandon Conovitz — “Default fit notes per PDF”
- Curtis Nielsen vest ×2 — style grid dump
- Robert Fribourg one jacket — sleeve inseam text only

### Pass 3–4 — Photos + Customer portal fields
```bash
python3 ~/ls-house-app/scripts/promote_mtmpro_photos.py --write
```
- Customer fields: `lsh_headshot`, `lsh_photo_front/side/back`, `lsh_portal_show_photos`, `lsh_photo_source`
- Also sets standard `Customer.image` (profile)
- Sources: Photos PDFs + MTMPro order PDF embeds
- Portal (`my.lstailors.com`): home avatar + profile fit-photo grid

## Auto-hook (live)

Hermes cron **every 15m** · job `fb241faa1a2b` · local delivery (no spam when idle):

```bash
python3 ~/ls-house-app/scripts/auto_promote_mtmpro_masters.py --write --lookback-hours 48 --limit 20 --quiet-ok
```

Picks up:
1. MTMPro with `fit_notes` and empty `body_measurement_set`
2. Recent orders (48h) where Customer lacks `lsh_current_bms` or headshot

Then runs promote → Current collapse → photos → hub link for those customers.

Manual one-shot:
```bash
python3 ~/ls-house-app/scripts/auto_promote_mtmpro_masters.py --write --order LST-XXXX
```

State: `scripts/data/auto_promote_state.json` · reports `auto_promote_write_*.json`

Unparseable fit_notes (posture-only / style dump) stay unlinked — expected.