# Installing LSH House on ERPNext

The L&S House app requires custom DocTypes on your Frappe/ERPNext site. Install the bundled **`lsh_house`** Frappe app.

## Quick install (bench)

From your Frappe bench directory:

```bash
# Copy or clone the app into bench apps/
cp -r /path/to/ls-house-app/backend/erpnext/lsh_house apps/lsh_house

# Install on your site
bench --site erp.lstailors.com install-app lsh_house

# Migrate + reload
bench --site erp.lstailors.com migrate
bench restart
```

## Regenerate DocTypes (developers)

If you change the schema in `generate_doctypes.py`:

```bash
cd backend/erpnext
python3 generate_doctypes.py
bench --site YOUR_SITE migrate
```

## Verify from the LSH backend

After install, confirm all DocTypes exist:

```bash
cd backend
bun run src/scripts/verify-erpnext-setup.ts
```

Seed NYC/HOU locations and the agent roster:

```bash
bun run src/scripts/seed-erpnext-lsh.ts
```

## What gets installed

| Package | Contents |
|---------|----------|
| **35+ DocTypes** | Locations, parked carts, custom orders, agents, SMS, approvals, etc. |
| **Customer custom fields** | `custom_lst_division`, `custom_vip_tier`, … |
| **User custom field** | `lst_location` (for app role scoping) |
| **Fixtures** | NYC + HOU locations, Maestro/Sofia/Mia/Rocco/Melena/Filo agents |

## LST roles on ERPNext User

The app maps these ERPNext roles (create in Role Permission Manager if missing):

- `LST Super Admin`
- `LST Store Manager`
- `LST Salesperson`
- `LST Driver`
- `LST Tailor`

Each user needs `lst_location` set to `NYC`, `HOU`, etc.

## Already on your site (no install needed)

These existed before the Supabase migration:

- Alteration Ticket, Alteration Preset
- LSH Delivery, LSH Notification Log
- Sales Order, Sales Invoice, HD Ticket
- Employee, Company, Communication

## Troubleshooting

**DocType missing errors in app logs**  
Run `verify-erpnext-setup.ts` and install any missing DocTypes via `install-app lsh_house`.

**Permission errors**  
Ensure your API key user has read/write on all LSH DocTypes (System Manager or custom role).

**Customer search empty**  
Confirm Customer custom fields are installed (`custom_lst_division`, etc.).

See also: [LSH_DOCTYPES.md](./LSH_DOCTYPES.md)
