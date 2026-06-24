# ERPNext unification audit

## Runtime confirmation

- Current MCP runtime in this repo: TypeScript on Bun.
- Existing standalone-style package: `mcp/server.ts`.
- Monorepo sidecar added: `apps/erp-mcp/server.ts`.
- Because the MCP server is TypeScript/Bun, it does not need a Python/FastAPI sidecar.

## Data-display to DocType map

| App area | Files audited | Data displayed | ERPNext source |
| --- | --- | --- | --- |
| Global search and notifications | `webapp/src/components/shell/TopBar.tsx` | customers, alterations, sales orders, invoices, fabrics, tasks, messages, notifications | `Customer`, `Alteration Ticket`, `Sales Order`, `Sales Invoice`, `LSH Fabric Pricing`, `LSH Task`, `LSH SMS Message`, `LSH Agent Event`/notification route data |
| Dashboard | `webapp/src/pages/Dashboard.tsx`, `webapp/src/components/dashboard/*` | KPIs, revenue trends, top customers, top garments, alteration pipeline, YZ helpdesk tickets | `Sales Invoice`, `Sales Order`, `Customer`, `Alteration Ticket`, `LSH Custom Order`, `LSH Delivery`, `HD Ticket` |
| Customers | `webapp/src/pages/Customers.tsx`, `webapp/src/pages/CustomerDetail.tsx`, `webapp/src/components/pos/CustomerField.tsx`, `webapp/src/components/pos/CustomerEditSheet.tsx` | customer records, dossier, addresses, contact details, preferences | `Customer`, `Address`, `Contact`, `LSH Customer Dossier`, `LSH Customer Communication` |
| Alteration lists and detail | `webapp/src/pages/orders/OrdersAlterations.tsx`, `webapp/src/pages/orders/AlterationDetail.tsx`, `webapp/src/components/alterations/*` | tickets, garments, alteration line items, tailor assignment, workflow status, transfers, briefs | `Alteration Ticket`, child garment/line tables on `Alteration Ticket`, `Employee`, `LSH Location`, `LSH Transfer`/transfer route data |
| Combined order desk | `webapp/src/pages/orders/SalesOrders.tsx` | custom sales orders and alteration tickets in one view | `Sales Order`, `Alteration Ticket` |
| Sales order detail | `webapp/src/pages/orders/SalesOrderDetail.tsx` | sales order header, customer, line items, invoices, factory order candidates | `Sales Order`, `Sales Order Item`, `Customer`, `Sales Invoice`, `MTMPro Order` |
| Invoices | `webapp/src/pages/orders/Invoices.tsx`, `webapp/src/pages/orders/InvoiceDetail.tsx`, `webapp/src/pages/PayInvoice.tsx` | invoice rows, line items, taxes, payments, payment links, outstanding balances | `Sales Invoice`, `Sales Invoice Item`, `Sales Taxes and Charges`, `Payment Entry`, `LSH Payment Request` |
| Custom orders | `webapp/src/pages/orders/OrdersCustom.tsx`, `webapp/src/pages/orders/CustomOrderDetail.tsx`, `webapp/src/pages/intake/IntakeCustom.tsx`, `webapp/src/components/pos/*` | garment specs, fabrics, styles, deposits, Square terminal status | `LSH Custom Order`, `LSH Custom Order Garment`, `LSH Fabric Pricing`, `LSH Style Library`, `Sales Order`, `Payment Entry` |
| Alteration intake and receipts | `webapp/src/pages/intake/IntakeAlterations.tsx`, `TicketDetail.tsx`, `AlterationReceipt.tsx`, `AlterationTags.tsx`, `QRScanner.tsx`, `GarmentTag.tsx`, `ETicket.tsx`, `DeliveryLabel.tsx` | intake forms, ticket detail, QR tags, receipts, labels | `Alteration Ticket`, child garment/line tables, `File`, `Customer`, `Address` |
| Deliveries | `webapp/src/pages/Deliveries.tsx`, `DeliveryDetail.tsx`, `DeliveryTracking.tsx`, `webapp/src/components/deliveries/*`, `webapp/src/components/maps/*` | delivery queues, route map, proof of delivery, AI delivery insights, generated messages | `LSH Delivery`, `LSH Delivery Timeline`, `File`, `Customer`, `Address`, `Alteration Ticket`, `Sales Order` |
| Communications/Sofia/Comms | `webapp/src/pages/Communications.tsx`, `Comms.tsx`, `SofiaChat.tsx`, `webapp/src/components/RavenChat.tsx` | calls, SMS threads, Sofia handoff, chat/events | `LSH SMS Message`, `LSH Call Log`, `LSH Conversation Handoff`, `LSH Sofia Activity Log`, `LSH Agent Message` |
| Mission Control and Tasks | `webapp/src/pages/MissionControl.tsx`, `webapp/src/pages/mission-control/AgentDetail.tsx`, `webapp/src/pages/Tasks.tsx`, `webapp/src/components/tasks/*` | agents, events, tasks, approvals, audit, cost, live feed | `LSH Agent`, `LSH Agent Task`, `LSH Agent Event`, `LSH Approval Queue`, `LSH Approval Decision`, `LSH Audit Log`, `LSH Agent Cost`, `LSH Cron Job` |
| Admin | `webapp/src/pages/admin/*` | users, locations, tailors, overview counts, alteration board | `User`, `Employee`, `LSH Location`, `Alteration Ticket` |
| Reference | `webapp/src/pages/reference/FabricPricingPage.tsx`, `StyleLibraryPage.tsx` | fabric pricing and style options | `LSH Fabric Pricing`, `LSH Style Library` |
| Appointments/Calendar | `webapp/src/pages/Appointments.tsx`, `Calendar.tsx`, `webapp/src/components/appointments/*` | appointments, blocks, rooms/agents, public booking | `LSH Appointment`, `LSH Appointment Type`, `LSH Agent`, `Event`/calendar route data |
| Helpdesk/YZ | `webapp/src/pages/Helpdesk.tsx`, `webapp/src/pages/helpdesk/HelpdeskTicketDetail.tsx`, `webapp/src/components/dashboard/OpenYZTickets.tsx` | ticket queues, ticket details, replies, YZ escalation | `HD Ticket`, `Communication`, `ToDo`, `LSH Task` |
| Financials | `webapp/src/pages/Financials.tsx` | revenue, A/R, gross profit, pipeline, top garments/customers, sales reps | `Sales Invoice`, `Payment Entry`, `Sales Order`, `Customer`, `Item` |
| Settings/Login/Placeholder/Academy/NotFound | `Settings.tsx`, `Login.tsx`, `Placeholder.tsx`, `Academy.tsx`, `NotFound.tsx` | navigation, auth, static help/empty content | no primary ERPNext DocType |

## Static, hardcoded, or local-only data found

These are the remaining non-ERP arrays/constants found during the audit. Most are UI enums, labels, filters, visual tokens, or form defaults; they are not live business records unless called out.

- Navigation and access lists: `Sidebar.tsx` role arrays and section definitions.
- Filter/tab definitions: `OrdersCustom.tsx`, `OrdersAlterations.tsx`, `Invoices.tsx`, `SalesOrders.tsx`.
- Status/stage enums and labels: custom order stages, invoice filters, delivery/POD methods, message types.
- Garment/style UI options: `EditTicketDrawer.tsx` garment type list, POS garment/style label maps.
- Visual constants: badge colors, medal colors, dashboard chart labels, appointment day labels.
- Form defaults/placeholders: new delivery method/location defaults, booking default duration, empty search placeholder text.
- AI prompt text: alteration daily brief prompt and delivery message-generation prompts.
- Static/help pages: `Academy.tsx`, `Placeholder.tsx`, `NotFound.tsx` contain static UI/help copy.

## Live data status

- Existing domain pages already use React Query through `webapp/src/lib/queries.ts` and backend `/api/*` routes.
- Backend routes for customers, sales orders, invoices, alterations, deliveries, reference data, agents, helpdesk, and appointments already call ERPNext helpers or `erpList`/`erpGet`.
- Added `backend/src/lib/erp-rest.ts` as the canonical ERPNext REST client.
- Added app-authenticated `/api/erp-rest/*` proxy for browser-safe REST-style ERPNext access.
- Added generic `/api/mcp/erp/*` tool endpoints for:
  - `erp_list`
  - `erp_get`
  - `erp_create`
  - `erp_update`
  - `erp_count`
  - `erp_doctype_fields`
  - `erp_run_method`
  - `erp_ping`
- Added frontend clients:
  - `webapp/src/lib/erp-rest.ts`
  - `webapp/src/lib/erp-mcp.ts`
  - `useErpDocTypeSchema()` in `webapp/src/lib/queries.ts`
