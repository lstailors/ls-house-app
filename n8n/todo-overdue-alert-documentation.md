# Todo Overdue Alert Workflow (Step 7)

## Overview
The **Todo Overdue Alert** workflow is a real-time notification system that monitors todo items and sends alerts when they become overdue. It integrates with multiple communication channels: the ERP system's Raven messaging platform and BlueBubbles for SMS/messaging.

**Workflow ID**: todo-overdue-alert  
**Status**: Validated and Ready  
**Created**: 2026-06-10

---

## Architecture

### Trigger: Webhook
- **Type**: n8n-nodes-base.webhook
- **Method**: POST
- **Path**: /todo-overdue
- **Response Mode**: responseNode

Receives incoming todo overdue notifications with the following payload:

```json
{
  "status": "Open",
  "description": "Complete project proposal",
  "context": "Q2 Planning",
  "due": "2026-06-08",
  "priority": "High",
  "agent": "Maestro",
  "chatGuid": "iMessage;+;user@example.com"
}
```

---

## Workflow Steps

### Step 1: Check Status
**Type**: n8n-nodes-base.if (Conditional)

Checks if the todo status is "Open". Only continues if condition is true; otherwise stops execution.

**Condition**: `status === "Open"`

### Step 2: Send Raven Message
**Type**: n8n-nodes-base.httpRequest

Sends an alert to the ERP system's Raven messaging platform in the todos channel.

**Configuration**:
- **Endpoint**: https://erp.lstailors.com/api/resource/Raven Message
- **Method**: POST
- **Authentication**: Bearer token (ERP_API_KEY:ERP_API_SECRET)

**Request Body**:
```json
{
  "channel_id": "L&S Tailors-todos",
  "text": "🚨 OVERDUE: {{description}} · context: {{context}} · was due {{due}}",
  "message_type": "Text",
  "is_bot_message": 1,
  "bot": "Maestro-Raven"
}
```

### Step 3: Send BlueBubbles Alert
**Type**: n8n-nodes-base.httpRequest

Sends an SMS/message alert via BlueBubbles to the configured chat GUID.

**Configuration**:
- **Endpoint**: http://10.0.1.213:1234/api/v1/message/text
- **Method**: POST
- **Authentication**: Password header (BLUEBUBBLES_PASSWORD)

**Request Body**:
```json
{
  "chatGuid": "{{chatGuid}}",
  "message": "🚨 Overdue todo: {{description}} ({{context}}) — was due {{due}}",
  "method": "apple-script"
}
```

### Step 4: Respond to Webhook
**Type**: n8n-nodes-base.respondToWebhook

Returns a success response to the webhook caller.

**Response**:
```json
{
  "status": "alerted"
}
```

---

## Data Flow

```
Webhook POST /todo-overdue
        ↓
   Check Status
    ↙      ↘
  true    false
   ↓        ↓
   Send    Stop
   Raven
    ↓
  Send BlueBubbles
    ↓
  Respond Success
```

---

## Environment Variables

Required environment variables in n8n:

| Variable | Purpose | Example |
|----------|---------|---------|
| `ERP_API_KEY` | ERPNext API key | `user@example.com` |
| `ERP_API_SECRET` | ERPNext API secret | `abcd1234efgh5678` |
| `BLUEBUBBLES_PASSWORD` | BlueBubbles authentication | `secure-password-here` |

---

## Expression Variables

| Expression | Source | Type |
|-----------|--------|------|
| `{{$json.status}}` | Webhook body | string |
| `{{$json.description}}` | Webhook body | string |
| `{{$json.context}}` | Webhook body | string |
| `{{$json.due}}` | Webhook body | string (date) |
| `{{$json.priority}}` | Webhook body | string |
| `{{$json.agent}}` | Webhook body | string |
| `{{$json.chatGuid}}` | Webhook body | string |
| `{{$env.ERP_API_KEY}}` | Environment | string |
| `{{$env.ERP_API_SECRET}}` | Environment | string |
| `{{$env.BLUEBUBBLES_PASSWORD}}` | Environment | string |

---

## Testing

### Sample Webhook Request

```bash
curl -X POST \
  http://[n8n-instance]/webhook/todo-overdue \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "Open",
    "description": "Complete project proposal",
    "context": "Q2 Planning",
    "due": "2026-06-08",
    "priority": "High",
    "agent": "Maestro",
    "chatGuid": "iMessage;+;user@example.com"
  }'
```

### Expected Response

```json
{
  "status": "alerted"
}
```

---

## Error Handling

### Status Not "Open"
If `status !== "Open"`, the workflow stops execution (no alerts sent).

### HTTP Request Failures
If either Raven or BlueBubbles requests fail:
- The workflow halts at the failing node
- The HTTP request returns its native error response
- Monitor the n8n execution logs for debugging

### Missing Environment Variables
- Raven request will fail with 401 if ERP_API_KEY or ERP_API_SECRET are invalid
- BlueBubbles request will fail with 401 if BLUEBUBBLES_PASSWORD is invalid

---

## Message Examples

### Raven Message (ERP)
```
🚨 OVERDUE: Complete project proposal · context: Q2 Planning · was due 2026-06-08
```

### BlueBubbles Message (SMS/iMessage)
```
🚨 Overdue todo: Complete project proposal (Q2 Planning) — was due 2026-06-08
```

---

## Integration Points

1. **ERPNext Raven** - For team communication in the todos channel
2. **BlueBubbles** - For personal SMS/iMessage notifications
3. **Webhook Caller** - Returns status confirmation

---

## Performance Notes

- **Execution Time**: ~500-1000ms (depends on endpoint response times)
- **Parallelization**: Raven and BlueBubbles could be sent in parallel with a merge node (optional optimization)
- **Rate Limiting**: Monitor ERP API and BlueBubbles rate limits

---

## Maintenance

### Monitoring
- Check n8n execution logs for webhook invocations
- Verify Raven messages appear in the todos channel
- Confirm BlueBubbles messages deliver correctly

### Updates
- To change message format, edit the `text` and `message` expressions in steps 2 and 3
- To add more notification channels, add new HTTP Request nodes before the final response
- To change filtering criteria, modify the condition in Step 1

---

## Source Code

**File**: `/home/user/ls-house-app/n8n/todo-overdue-alert.ts`

Uses the n8n Workflow SDK with the following imports:
```typescript
import { workflow, trigger, node, expr } from 'n8n-workflow';
```

---

## Validation Status

✓ Syntax validated  
✓ SDK patterns validated  
✓ Expression syntax validated  
✓ Node types verified  
✓ Connections verified  
✓ Ready for deployment

---

## Related Workflows

- **Morning Brief** - Provides daily summary of open todos (Step 3)
- **Square Terminal Webhook** - Handles payment notifications (alternative pattern example)

---

## Support

For issues or enhancements:
1. Check n8n execution logs
2. Verify environment variables are set
3. Test webhook endpoint with curl
4. Review error responses from ERPNext or BlueBubbles
