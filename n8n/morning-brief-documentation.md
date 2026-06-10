# Morning Brief n8n Workflow

## Overview
This workflow automates a daily morning briefing that compiles open todos and calendar meetings into a formatted message sent via BlueBubbles.

## Schedule
- **Time**: 6:00 AM EST/EDT (America/New_York timezone)
- **Days**: Monday - Saturday (runs 6 times per week)
- **Cron**: `0 6 * * 1,2,3,4,5,6`

## Nodes & Flow

### 1. Schedule Trigger (Cron)
- **Type**: n8n-nodes-base.cronTrigger
- **Purpose**: Initiates workflow at 6 AM Mon-Sat
- **Configuration**:
  - Expression: `0 6 * * 1,2,3,4,5,6` (6 AM, Mon-Sat)
  - Timezone: America/New_York

### 2. Get Open Todos (HTTP Request)
- **Type**: n8n-nodes-base.httpRequest
- **Method**: GET
- **URL**: `https://erp.lstailors.com/api/resource/ToDo`
- **Authentication**: HTTP Basic Auth (ERP_API_KEY:ERP_API_SECRET)
- **Query Parameters**:
  - `filters`: JSON array filtering for status="Open" AND allocated_to="carl@lstailors.com"
  - `fields`: ["name", "description", "date", "priority", "lsh_context", "reference_type", "reference_name", "lsh_agent", "lsh_comms_source"]
  - `limit_page_length`: 50
  - `order_by`: "priority asc, date asc"
- **Output**: Array of open todo items sorted by priority and date

### 3. Get Upcoming Bookings (HTTP Request)
- **Type**: n8n-nodes-base.httpRequest
- **Method**: GET
- **URL**: `https://api.cal.com/v1/bookings`
- **Authentication**: Bearer token from CAL_API_KEY credential
- **Query Parameters**:
  - `status`: "upcoming"
  - `dateFrom`: "{{$today}}" (today's date)
  - `dateTo`: "{{$today}}" (same day)
- **Output**: Today's calendar meetings/bookings

### 4. Transform Data (Code Node)
- **Type**: n8n-nodes-base.code
- **Language**: JavaScript
- **Mode**: runOnceForAllItems
- **Purpose**: Formats todos and bookings with emojis into a readable message
- **Logic**:
  - Maps todos with priority indicators:
    - 🔴 High priority
    - 🟡 Medium priority
    - 🟢 Low priority
  - Formats booking details (title, time, duration, guest)
  - Combines into a formatted morning brief message with headers
- **Output**: `{ json: { message: "formatted_text" } }`

### 5. Send BlueBubbles (HTTP Request)
- **Type**: n8n-nodes-base.httpRequest
- **Method**: POST
- **URL**: `http://10.0.1.213:1234/api/v1/message/text`
- **Authentication**: Custom header with BLUEBUBBLES_PASSWORD
- **Body**: JSON object containing:
  - `to`: "carl@lstailors.com"
  - `message`: Formatted text from Transform Data node
- **Header**:
  - `X-API-KEY`: BLUEBUBBLES_PASSWORD environment variable

## Required Credentials

1. **erpApiKey** (HTTP Basic Auth)
   - Username: ERP_API_KEY
   - Password: ERP_API_SECRET
   - Used for Frappe/ERPNext API authentication

2. **calApiKey** (HTTP Bearer Token)
   - Token: CAL_API_KEY
   - Used for cal.com API authentication

3. **BLUEBUBBLES_PASSWORD** (Environment Variable)
   - Used in X-API-KEY header for BlueBubbles API

## Example Output

```
☀️ MORNING BRIEF - Tuesday, Jun 10

📋 OPEN TODOS
🔴 [High] Fix login bug in mobile app
   📅 Due: 2026-06-10
   Context: Mobile App - Authentication
   Reference: Issue: ISSUE-142
   
🟡 [Medium] Review PR #45
   📅 Due: 2026-06-12
   Context: Code Review - Backend
   Reference: PullRequest: PR-45

🟢 [Low] Update documentation
   📅 Due: 2026-06-15
   Context: Docs - API Reference
   Reference: Task: TASK-89

📅 TODAY'S MEETINGS
📞 Team Standup
   ⏰ Time: 10:00:00 AM
   Duration: 30min
   Guest: Team Lead
   
📞 Client Call
   ⏰ Time: 2:00:00 PM
   Duration: 60min
   Guest: John Smith

---
Generated at 6:00:15 AM
```

## Data Flow

```
Schedule Trigger (6 AM)
    |
    +---> Get Open Todos ----\
    |                         |
    +---> Get Upcoming Bookings ---> Transform Data ---> Send BlueBubbles
```

## Error Handling Considerations

- If ERP API returns no todos, displays "No open todos"
- If cal.com API returns no bookings, displays "No upcoming meetings"
- Missing fields gracefully fallback to defaults (e.g., "N/A" for missing context)

## Testing the Workflow

1. Manual test: Run the workflow execution in n8n UI
2. Verify todos are fetched with correct filters
3. Verify bookings show only today's meetings
4. Check BlueBubbles message format and delivery
5. Validate all credentials are properly configured
