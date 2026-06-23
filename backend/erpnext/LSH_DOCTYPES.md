# LSH ERPNext DocTypes

## Install on ERPNext

**Before deploying the app**, install the bundled Frappe app:

```bash
bench --site YOUR_SITE install-app lsh_house
```

Full instructions: **[INSTALL.md](./INSTALL.md)**

Run verification from the backend:

```bash
bun run src/scripts/verify-erpnext-setup.ts
bun run src/scripts/seed-erpnext-lsh.ts
```

DocType names are defined in `backend/src/lib/erpnext/doctypes.ts`.
Generated JSON lives in `backend/erpnext/lsh_house/`.

## Core business (Phase 2)

| DocType | Purpose | Key fields |
|---------|---------|------------|
| **LSH Location** | Store locations (NYC, HOU, …) | `location_code`, `location_name`, `erpnext_company`, `square_location_id`, `is_active` |
| **LSH Fabric Pricing** | Fabric reference pricing | `fabric_name`, `mill`, `price`, `is_active` |
| **LSH Style Library** | Style reference | `category`, `style_name`, `description`, `image_url` |
| **LSH Parked Cart** | Saved intake carts | `location`, `cart_json` (JSON), `customer_snapshot` (JSON), `status` |
| **LSH Customer Dossier** | Rich client notes | `customer` (Link Customer), `dossier_json`, `lsh_*` text fields |
| **LSH Custom Order** | Bespoke orders | `customer`, `origin_location`, `status`, `order_total`, `deposit_amount`, `erp_sales_order` |
| **LSH Custom Order Garment** | Child table on Custom Order | `garment_type`, `price`, `garment_status` |

### Customer custom fields

Add to standard **Customer** DocType:

- `custom_lst_division` (Data) — NYC / HOU
- `custom_vip_tier`, `custom_status`, `custom_client_notes`, `custom_style_preferences`, `custom_fit_notes`, etc.

## AI ops (Phase 4)

| DocType | Replaces Supabase table |
|---------|------------------------|
| **LSH Agent** | `lsh.agents` |
| **LSH Agent Task** | `lsh.agent_tasks` |
| **LSH Agent Event** | `lsh.agent_events` |
| **LSH Agent Brief** | `agent_briefs` |
| **LSH Agent Cost** | agent costs |
| **LSH Approval Queue** | `approval_queue` |
| **LSH Approval Decision** | `approval_decisions` |
| **LSH SMS Message** | `sms_messages` |
| **LSH Call Log** | `unifi_call_logs` |
| **LSH Brain Entry** | `brain_entries` |
| **LSH Pending Email Draft** | `pending_email_drafts` |
| **LSH Audit Log** | audit log |
| **LSH Escalation** | `c_escalations` |
| **LSH Task** / **LSH Task Item** | `ls_tasks` |
| **LSH Mfg Order** | `mfg_orders` |
| **LSH Conversation Handoff** | `conversation_handoffs` |
| **LSH Sofia Activity Log** | `sofia2_activity_log` |

## Already existing (pre-migration)

These were already in use — no new install needed:

- Alteration Ticket, Alteration Preset
- LSH Delivery, LSH Notification Log
- Sales Order, Sales Invoice
- HD Ticket (Helpdesk)
- Employee, Company, Communication

## Files & payments (Phase 3)

- Use standard **File** DocType via `/api/method/upload_file`
- Square Terminal: `/api/square/terminal-checkout` (backend route, no Supabase)

## Environment

Remove Supabase env vars. Required:

```
ERPNEXT_BASE_URL=
ERPNEXT_API_KEY=
ERPNEXT_API_SECRET=
JWT_SECRET=
```

Optional: `ERPNEXT_MCP_URL`, `ERPNEXT_MCP_TOKEN`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`
