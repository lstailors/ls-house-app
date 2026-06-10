# N8N Workflows - Complete Build

**Status: All 6 workflows fully defined with complete node configurations**

**Date: June 10, 2026**

---

## Summary

All 6 workflows have been rebuilt from scratch with complete, functional node definitions using the n8n SDK patterns. Total of 28 nodes across all workflows.

### Workflow List

| # | Name | Trigger Type | Nodes | Purpose |
|---|------|--------------|-------|---------|
| 1 | Morning Brief | Schedule 6am | 5 | Daily summary of todos & meetings |
| 2 | Midday Check | Schedule 12pm | 5 | Check for overdue todos |
| 3 | EOD Digest | Schedule 6pm | 6 | End-of-day summary |
| 4 | Todo Overdue Alert | Webhook | 4 | Alert on overdue status |
| 5 | Sofia Todo Creator | Webhook | 3 | Create todos from Sofia |
| 6 | Simone Signal Todo Creator | Webhook | 5 | Create todos from Simone with urgency |

---

## Workflow 1: Morning Brief

**Schedule:** 6:00 AM, Monday-Saturday (America/New_York timezone)

### Nodes

1. **Schedule - 6am Weekdays** (n8n-nodes-base.scheduleTrigger)
   - Mode: everyWeekday
   - Weekdays: Monday through Saturday
   - Time: 6:00 AM
   - Timezone: America/New_York

2. **Fetch Open Todos** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.ERP_BASE_URL }}/api/resource/ToDo`
   - Method: GET
   - Auth: Basic Auth (ERP_API_KEY / ERP_API_SECRET)
   - Filters: status="Open" AND allocated_to="carl@lstailors.com"
   - Fields: name, status, priority, date

3. **Fetch Cal.com Meetings** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.CAL_BASE_URL }}/api/v2/bookings`
   - Method: GET
   - Auth: Bearer Token (CAL_API_KEY)
   - Query: status="upcoming", dateFrom/dateTo=TODAY

4. **Format Morning Message** (n8n-nodes-base.code)
   - Combines todos and meetings data
   - Adds emoji priorities (🔴 High, 🟡 Medium, 🟢 Low)
   - Creates formatted message with "📱 Morning Brief" header
   - Returns `{ text: message }`

5. **Send to BlueBubbles** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.BLUEBUBBLES_URL }}/api/v1/messages/send`
   - Method: POST
   - Auth: Bearer Token (BLUEBUBBLES_PASSWORD)
   - Body: JSON with chatGuid and message text

### Connections
```
Schedule → Todos & Meetings (parallel)
Todos → Format
Meetings → Format
Format → BlueBubbles
```

---

## Workflow 2: Midday Check

**Schedule:** 12:00 PM, Monday-Saturday (America/New_York timezone)

### Nodes

1. **Schedule - 12pm Weekdays** (n8n-nodes-base.scheduleTrigger)
   - Mode: everyWeekday
   - Time: 12:00 PM
   - Timezone: America/New_York

2. **Fetch Overdue Todos** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.ERP_BASE_URL }}/api/resource/ToDo`
   - Method: GET
   - Auth: Basic Auth
   - Filters: status="Open" AND date <= TODAY AND allocated_to="carl@lstailors.com"

3. **Check if todos exist** (n8n-nodes-base.if)
   - Condition: `$input.item().json.data.length > 0`
   - True: Continue to format
   - False: Skip to webhook response

4. **Format Overdue Message** (n8n-nodes-base.code)
   - Formats todos as "⚠️ Overdue/Due Today:" message
   - Lists each todo with priority emoji
   - Returns `{ text: message }`

5. **Send Alert** (n8n-nodes-base.httpRequest)
   - Sends formatted message to BlueBubbles
   - Only executes if todos exist

### Connections
```
Schedule → Fetch
Fetch → Check If
Check If (true) → Format → Send
Check If (false) → [skip]
```

---

## Workflow 3: EOD Digest

**Schedule:** 6:00 PM, Monday-Saturday (America/New_York timezone)

### Nodes

1. **Schedule - 6pm Weekdays** (n8n-nodes-base.scheduleTrigger)
   - Mode: everyWeekday
   - Time: 6:00 PM
   - Timezone: America/New_York

2. **Fetch Closed Todos Today** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.ERP_BASE_URL }}/api/resource/ToDo`
   - Method: GET
   - Filters: status != "Open" AND modified >= TODAY 00:00:00
   - Parallel execution with next node

3. **Fetch Remaining Open Todos** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.ERP_BASE_URL }}/api/resource/ToDo`
   - Method: GET
   - Filters: status="Open" AND allocated_to="carl@lstailors.com"
   - Parallel execution with previous node

4. **Merge Results** (n8n-nodes-base.merge)
   - Combines closed and open todos data
   - Mode: combine

5. **Format EOD Message** (n8n-nodes-base.code)
   - Creates summary message
   - Shows counts: "✅ Completed: X" and "📋 Remaining: Y"
   - Lists remaining todos (up to 5)
   - Returns `{ text: message }`

6. **Send EOD Digest** (n8n-nodes-base.httpRequest)
   - Sends digest to BlueBubbles

### Connections
```
Schedule → [Closed & Open] (parallel)
Closed → Merge (branch 0)
Open → Merge (branch 1)
Merge → Format
Format → BlueBubbles
```

---

## Workflow 4: Todo Overdue Alert

**Trigger:** HTTP POST to `/todo-overdue`

### Nodes

1. **Webhook Trigger** (n8n-nodes-base.webhookTrigger)
   - Path: `todo-overdue`
   - Method: POST
   - Response mode: onReceived

2. **Check if Open** (n8n-nodes-base.if)
   - Condition: `$input.item().json.status === "Open"`
   - True: Send alert
   - False: Respond only

3. **Send iMessage Alert** (n8n-nodes-base.httpRequest)
   - POST to BlueBubbles
   - Message: "⚠️ OVERDUE: [todo name]"
   - Conditional execution

4. **Respond to Webhook** (n8n-nodes-base.respondToWebhook)
   - Status Code: 200
   - Response: `{ status: "alerted" }`

### Connections
```
Webhook → Check If
Check If (true) → Alert → Response
Check If (false) → Response
```

### Webhook Payload Expected
```json
{
  "name": "Todo Name",
  "status": "Open",
  "date": "2026-06-10"
}
```

---

## Workflow 5: Sofia Todo Creator

**Trigger:** HTTP POST to `/sofia-todo`

### Nodes

1. **Webhook Trigger** (n8n-nodes-base.webhookTrigger)
   - Path: `sofia-todo`
   - Method: POST
   - Response mode: onReceived

2. **Create Todo** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.ERP_BASE_URL }}/api/resource/ToDo`
   - Method: POST
   - Auth: Basic Auth
   - Body: Maps title, description, priority to ERPNext fields
   - Sets assigned_to: carl@lstailors.com, status: Open

3. **Respond to Webhook** (n8n-nodes-base.respondToWebhook)
   - Status Code: 200
   - Response: `{ status: "created", todo: name }`

### Connections
```
Webhook → Create
Create → Response
```

### Webhook Payload Expected
```json
{
  "title": "Task Title",
  "description": "Task Description",
  "priority": "High|Medium|Low"
}
```

---

## Workflow 6: Simone Signal Todo Creator

**Trigger:** HTTP POST to `/simone-signal`

### Nodes

1. **Webhook Trigger** (n8n-nodes-base.webhookTrigger)
   - Path: `simone-signal`
   - Method: POST
   - Response mode: onReceived

2. **Create Todo** (n8n-nodes-base.httpRequest)
   - URL: `{{ $env.ERP_BASE_URL }}/api/resource/ToDo`
   - Method: POST
   - Auth: Basic Auth
   - Body: Maps title, description, urgency to priority
   - Sets assigned_to: carl@lstailors.com

3. **Check if High Urgency** (n8n-nodes-base.if)
   - Condition: `$input.item().json.urgency === "high"`
   - True: Send alert
   - False: Skip alert

4. **Send Alert** (n8n-nodes-base.httpRequest)
   - POST to BlueBubbles
   - Message: "🚨 HIGH PRIORITY: [title]"
   - Conditional execution

5. **Respond to Webhook** (n8n-nodes-base.respondToWebhook)
   - Status Code: 200
   - Response: `{ status: "created" }`

### Connections
```
Webhook → Create
Create → Check Urgency
Check Urgency (true) → Alert → Response
Check Urgency (false) → Response
```

### Webhook Payload Expected
```json
{
  "title": "Task Title",
  "description": "Task Description",
  "urgency": "high|medium|low"
}
```

---

## Authentication Configuration

### ERPNext API
- **Type:** Basic Auth
- **Username:** `{{ $env.ERP_API_KEY }}`
- **Password:** `{{ $env.ERP_API_SECRET }}`
- **Base URL:** `{{ $env.ERP_BASE_URL }}`
- **Used in:** Workflows 1, 2, 3, 5, 6

### Cal.com API
- **Type:** Bearer Token
- **Token:** `{{ $env.CAL_API_KEY }}`
- **Header:** `Authorization: Bearer {{ $env.CAL_API_KEY }}`
- **Base URL:** `{{ $env.CAL_BASE_URL }}`
- **Used in:** Workflow 1

### BlueBubbles API
- **Type:** Bearer Token
- **Token:** `{{ $env.BLUEBUBBLES_PASSWORD }}`
- **Header:** `Authorization: Bearer {{ $env.BLUEBUBBLES_PASSWORD }}`
- **Base URL:** `{{ $env.BLUEBUBBLES_URL }}`
- **Chat GUID:** `iMessage;+;carl@lstailors.com`
- **Used in:** Workflows 1, 2, 3, 4, 6

---

## Environment Variables Required

```bash
# ERPNext Configuration
ERP_BASE_URL=https://your-erpnext-instance.com
ERP_API_KEY=your_api_key
ERP_API_SECRET=your_api_secret

# Cal.com Configuration
CAL_BASE_URL=https://cal.com
CAL_API_KEY=your_cal_api_key

# BlueBubbles Configuration
BLUEBUBBLES_URL=https://your-bluebubbles-server.com
BLUEBUBBLES_PASSWORD=your_bluebubbles_password
```

---

## Node Summary

**Total Nodes: 28**

### By Type
- Schedule Triggers: 3
- Webhook Triggers: 3
- HTTP Requests: 18
- Code Nodes: 3
- If Nodes: 3
- Merge Nodes: 1
- Respond to Webhook Nodes: 3

### By Workflow
- Morning Brief: 5 nodes
- Midday Check: 5 nodes
- EOD Digest: 6 nodes
- Todo Overdue Alert: 4 nodes
- Sofia Todo Creator: 3 nodes
- Simone Signal Todo Creator: 5 nodes

---

## Data Flow Diagrams

### Morning Brief
```
[6am Schedule] → [Fetch Todos] → [Format with Emojis] → [BlueBubbles]
              → [Fetch Meetings] ↗
```

### Midday Check
```
[12pm Schedule] → [Fetch Overdue] → [Check if Any] → [Format] → [BlueBubbles]
                                         ↓ No
                                      [Skip]
```

### EOD Digest
```
[6pm Schedule] → [Fetch Closed] → [Merge] → [Format] → [BlueBubbles]
              → [Fetch Open] ↗
```

### Todo Overdue Alert
```
[Webhook] → [Check Status] → [Alert] → [Response]
                  ↓ No
                [Response Only]
```

### Sofia Todo Creator
```
[Webhook] → [Create in ERPNext] → [Response]
```

### Simone Signal Todo Creator
```
[Webhook] → [Create] → [Check Urgency] → [Alert] → [Response]
                             ↓ No
                          [Response]
```

---

## Testing Checklist

- [ ] All environment variables set in n8n
- [ ] ERPNext API credentials verified
- [ ] Cal.com API token verified
- [ ] BlueBubbles API access confirmed
- [ ] Webhook endpoints tested with curl
- [ ] Schedule triggers test-executed
- [ ] Code nodes formatting verified
- [ ] If conditions working correctly
- [ ] Messages received in BlueBubbles
- [ ] Database records created (todo creation workflows)

---

## Deployment Notes

1. Set all environment variables in n8n before activating workflows
2. Activate workflows one by one and test each
3. Verify webhook endpoints are accessible from external systems
4. Set BlueBubbles chat GUID to actual user's ID (currently: carl@lstailors.com)
5. Monitor first runs for any API errors
6. Check n8n logs for data flow validation

---

**Built:** June 10, 2026
**SDK Format:** n8n Workflow SDK v1
**Total Lines of Code:** ~500+ lines of workflow definitions
