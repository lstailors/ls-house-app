# ERP MCP sidecar

TypeScript/Bun MCP server for ERPNext tools, folded into the monorepo.

## Runtime

```bash
LST_BACKEND_URL=https://app.lstailors.com \
LST_MCP_SECRET=... \
bun run start
```

## Tools

- `erp_ping`
- `erp_list`
- `erp_get`
- `erp_create`
- `erp_update`
- `erp_count`
- `erp_doctype_fields`
- `erp_run_method`

The sidecar calls the app-hosted `/api/mcp/*` endpoints, so ERPNext credentials remain configured once on the app/backend deployment:

- `ERPNEXT_BASE_URL`
- `ERPNEXT_API_KEY`
- `ERPNEXT_API_SECRET`
- optional `ERPNEXT_SESSION_TOKEN`
- `LST_MCP_SECRET`
