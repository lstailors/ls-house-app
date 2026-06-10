# N8N Workflows - Quick Reference

## Workflow IDs

| Workflow | ID | Type | Nodes |
|----------|---|------|-------|
| Morning Brief | `TQ6OtZ8LAlp099va` | Scheduled | 4 |
| Midday Check | `PPC8RSDEQS6SmDDd` | Scheduled | 4 |
| EOD Digest | `0OXi5y3Cr9Yhc1WU` | Scheduled | 4 |
| Todo Overdue Alert | `V4QGLf34CmnChx41` | Webhook | 3 |
| Sofia Todo Creator | `DkyxfTfKirqFQmIR` | Webhook | 4 |
| Simone Signal Todo | `V7JMcqPbsp4SaJjd` | Webhook | 5 |

## Webhook URLs

```
https://lstailors.app.n8n.cloud/webhook-prod/todo-overdue
https://lstailors.app.n8n.cloud/webhook-prod/sofia-todo
https://lstailors.app.n8n.cloud/webhook-prod/simone-signal
```

## Schedules

| Workflow | Time | Days |
|----------|------|------|
| Morning Brief | 6:00 AM | Mon-Sat |
| Midday Check | 12:00 PM | Mon-Sat |
| EOD Digest | 6:00 PM | Mon-Fri |

## Timezone
America/New_York (EST/EDT)

## Dashboard
https://lstailors.app.n8n.cloud/

## Status
✅ All 6 workflows active and deployed

## Total Nodes
20 nodes across all workflows

## Setup Checklist
- [ ] Configure ERP API credentials
- [ ] Configure BlueBubbles credentials
- [ ] Test each workflow
- [ ] Monitor first execution
