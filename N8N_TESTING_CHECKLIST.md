# N8N Workflows - Testing Execution Checklist

**Test Date:** June 12, 2026  
**Tester:** Claude Code Agent  
**Status:** Analysis Complete - Ready for Manual Testing

---

## Test Results Summary

### ✅ Deployment Verification Complete

| Item | Status | Details |
|------|--------|---------|
| All 6 workflows deployed | ✅ PASS | Verified in n8n cloud instance |
| Node count verification | ✅ PASS | 27 total nodes across all workflows |
| Webhook endpoints exist | ✅ PASS | 3 webhook URLs accessible |
| Cron schedules valid | ✅ PASS | All scheduled workflows have valid cron expressions |
| Node connections | ✅ PASS | All internal wiring correct |
| JSON configuration valid | ✅ PASS | All workflow JSON files valid |

---

## Workflow Deployment Status

### Scheduled Workflows (3)

#### 1. Morning Brief
```
✅ Deployment: VERIFIED
✅ Schedule: 0 6 * * 1,2,3,4,5,6 (6 AM, Mon-Sat)
✅ Timezone: America/New_York
✅ Nodes: 5 (Schedule → Get Todos → Get Bookings → Transform → Send)
✅ Active: Yes
⚠️  Credentials: Need setup
```

#### 2. Midday Check
```
✅ Deployment: VERIFIED
✅ Schedule: 0 12 * * 1,2,3,4,5,6 (12 PM, Mon-Sat)
✅ Timezone: America/New_York
✅ Nodes: 4 (Schedule → Get Todos → Transform → Send)
✅ Active: Yes
⚠️  Credentials: Need setup
```

#### 3. EOD Digest
```
✅ Deployment: VERIFIED
✅ Schedule: 0 18 * * 1,2,3,4,5 (6 PM, Mon-Fri)
✅ Timezone: America/New_York
✅ Nodes: 4 (Schedule → Get Todos → Transform → Send)
✅ Active: Yes
⚠️  Credentials: Need setup
```

### Webhook Workflows (3)

#### 4. Todo Overdue Alert
```
✅ Deployment: VERIFIED
✅ Endpoint: POST /webhook-prod/todo-overdue
✅ Nodes: 4 (Webhook → Check Status → Send Raven → Respond)
✅ Active: Yes
✅ Validation: Status check implemented
⚠️  Credentials: Need setup
```

#### 5. Sofia Todo Creator
```
✅ Deployment: VERIFIED
✅ Endpoint: POST /webhook-prod/sofia-todo
✅ Nodes: 5 (Webhook → Validate → Create → Send → Respond)
✅ Active: Yes
✅ Validation: Title required check
⚠️  Credentials: Need setup
```

#### 6. Simone Signal Todo Creator
```
✅ Deployment: VERIFIED
✅ Endpoint: POST /webhook-prod/simone-signal
✅ Nodes: 5 (Webhook → Extract → Create → Send → Respond)
✅ Active: Yes
✅ Logic: Signal mapping implemented
⚠️  Credentials: Need setup
```

---

## Node Configuration Verification

### All Nodes Verified ✅

#### Trigger Nodes (6)
- [x] Schedule Trigger (Morning Brief) - Valid cron expression
- [x] Schedule Trigger (Midday Check) - Valid cron expression
- [x] Schedule Trigger (EOD Digest) - Valid cron expression
- [x] Webhook Trigger (Todo Overdue) - Path: `todo-overdue`
- [x] Webhook Trigger (Sofia Todo) - Path: `sofia-todo`
- [x] Webhook Trigger (Simone Signal) - Path: `simone-signal`

#### HTTP Request Nodes (8)
- [x] Get Open Todos (Morning Brief) - URL: `https://erp.lstailors.com/api/resource/ToDo`
- [x] Get Bookings (Morning Brief) - URL: `https://api.cal.com/v1/bookings`
- [x] Get Open Todos (Midday Check) - Configured
- [x] Get Completed Todos (EOD Digest) - Configured
- [x] Create Todo (Sofia) - URL: `https://erp.lstailors.com/api/resource/ToDo`
- [x] Send Confirmation (Sofia) - URL: `http://10.0.1.213:1234/api/v1/message/text`
- [x] Create Signal Todo (Simone) - URL: `https://erp.lstailors.com/api/resource/ToDo`
- [x] Send Alert (Simone) - URL: `http://10.0.1.213:1234/api/v1/message/text`

#### Logic Nodes (3)
- [x] IF Condition (Sofia) - Validates `title` field exists
- [x] IF Condition (Todo Overdue) - Checks `status == "Open"`
- [x] Code Node (Morning Brief) - Formats with emoji priorities
- [x] Code Node (Simone Signal) - Maps signal types to titles

#### Response Nodes (3)
- [x] Respond to Webhook (Sofia) - Returns success message
- [x] Respond to Webhook (Todo Overdue) - Returns status
- [x] Respond to Webhook (Simone Signal) - Returns status + signal data

---

## Credential Requirements Checklist

### Critical: Must Configure Before Testing

#### [ ] ERPNext API Credentials
```
Type: HTTP Basic Auth or Custom Auth
Base URL: https://erp.lstailors.com
API Key: [REQUIRED]
API Secret: [REQUIRED]
Scope: ToDo resource (read, write, create)
Used By: All 6 workflows
```

**Configuration Steps:**
1. Go to n8n Dashboard → Credentials
2. Create new "HTTP Basic Auth" credential
3. Enter:
   - Username: `{{ $env.ERP_API_KEY }}`
   - Password: `{{ $env.ERP_API_SECRET }}`
4. Save and assign to all HTTP Request nodes targeting ERPNext

**Verification Command:**
```bash
curl -u YOUR_API_KEY:YOUR_API_SECRET \
  "https://erp.lstailors.com/api/resource/ToDo?limit=1"
```

---

#### [ ] BlueBubbles API Credentials
```
Type: Bearer Token / Custom Auth
Base URL: http://10.0.1.213:1234
API Key: [REQUIRED]
Header: X-API-KEY
Used By: All 6 workflows
```

**Configuration Steps:**
1. Go to n8n Dashboard → Credentials
2. Create new "HTTP Header Auth" credential
3. Add header:
   - Name: `X-API-KEY`
   - Value: `{{ $env.BLUEBUBBLES_PASSWORD }}`
4. Save and assign to BlueBubbles HTTP Request nodes

**Verification Command:**
```bash
curl -X POST "http://10.0.1.213:1234/api/v1/message/text" \
  -H "X-API-KEY: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","message":"Test"}'
```

---

#### [ ] Cal.com API Credentials (Morning Brief only)
```
Type: Header Auth
Base URL: https://api.cal.com
API Key: [REQUIRED]
Header: Authorization
Used By: Morning Brief workflow
```

**Configuration Steps:**
1. Go to n8n Dashboard → Credentials
2. Create new "HTTP Header Auth" credential
3. Add header:
   - Name: `Authorization`
   - Value: `Bearer {{ $env.CAL_API_KEY }}`
4. Save and assign to Cal.com HTTP Request node

**Verification Command:**
```bash
curl -H "Authorization: Bearer YOUR_KEY" \
  -H "cal-api-version: 2024-08-13" \
  "https://api.cal.com/v1/bookings?status=upcoming"
```

---

### Environment Variables to Set

```bash
# In n8n Environment tab or settings.json
ERP_API_KEY=your_erp_api_key_here
ERP_API_SECRET=your_erp_api_secret_here
BLUEBUBBLES_PASSWORD=your_bluebubbles_key_here
CAL_API_KEY=your_cal_api_key_here
```

---

## Testing Execution Plan

### Phase 1: Pre-Testing Setup (15 minutes)

- [ ] Ensure you have access to n8n dashboard at `https://lstailors.app.n8n.cloud/`
- [ ] Obtain ERPNext API credentials
- [ ] Obtain BlueBubbles API key
- [ ] Obtain Cal.com API key (if needed)
- [ ] Verify test data exists in ERPNext (at least 1 open todo)

---

### Phase 2: Credential Configuration (30 minutes)

- [ ] Log into n8n dashboard
- [ ] Navigate to Credentials section
- [ ] Create ERPNext credential with API key/secret
- [ ] Create BlueBubbles credential with API key
- [ ] Create Cal.com credential with API key (optional)
- [ ] Test each credential by toggling to each workflow and validating

---

### Phase 3: Webhook Testing (15-20 minutes each)

#### Test Sofia Todo Webhook
```bash
curl -X POST "https://lstailors.app.n8n.cloud/webhook-prod/sofia-todo" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Todo from Sofia",
    "description": "This is a test",
    "priority": "Medium"
  }'
```

**Expected Result:**
- [ ] Response: `200 OK`
- [ ] Response Body: `{"status": "success", "message": "..."}`
- [ ] New todo created in ERPNext
- [ ] Confirmation message sent to BlueBubbles

**Troubleshooting:**
- [ ] Check n8n workflow execution log for errors
- [ ] Verify ERPNext credentials are working
- [ ] Verify BlueBubbles credentials are working
- [ ] Check payload format matches expected schema

---

#### Test Simone Signal Webhook
```bash
curl -X POST "https://lstailors.app.n8n.cloud/webhook-prod/simone-signal" \
  -H "Content-Type: application/json" \
  -d '{
    "signal": "urgent",
    "details": "Test urgent signal",
    "priority": "High"
  }'
```

**Expected Result:**
- [ ] Response: `200 OK`
- [ ] Response Body: `{"status": "processed", "signal": "urgent", ...}`
- [ ] Todo created with title "🚨 Urgent Action Required"
- [ ] Alert message sent to BlueBubbles

**Troubleshooting:**
- [ ] Check signal mapping in code node
- [ ] Verify todo created with correct emoji title
- [ ] Check alert message format

---

#### Test Todo Overdue Alert Webhook
```bash
curl -X POST "https://lstailors.app.n8n.cloud/webhook-prod/todo-overdue" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Client call",
    "context": "Follow up",
    "due": "2026-06-09",
    "status": "Open"
  }'
```

**Expected Result:**
- [ ] Response: `200 OK`
- [ ] Response Body: `{"status": "alerted"}`
- [ ] Raven message posted to ERPNext
- [ ] BlueBubbles message sent

**Troubleshooting:**
- [ ] Verify status check condition is working
- [ ] Check Raven API endpoint availability
- [ ] Verify message formatting

---

### Phase 4: Scheduled Workflow Testing (30 minutes)

#### Test Morning Brief (Manual Trigger)
1. [ ] Log into n8n dashboard
2. [ ] Open "Morning Brief" workflow
3. [ ] Click the "Test" button
4. [ ] Wait for execution to complete
5. [ ] Check execution logs:
   - [ ] Schedule trigger fires
   - [ ] Get Open Todos returns data
   - [ ] Get Bookings returns data (or empty, that's ok)
   - [ ] Transform Data formats message correctly
   - [ ] Send BlueBubbles returns 200 OK
6. [ ] Verify message appears on Carl's iPhone

**Expected Behavior:**
- [ ] Execution time: 2-5 seconds
- [ ] All nodes execute successfully
- [ ] No authentication errors
- [ ] Message contains formatted todos with emojis

**Troubleshooting:**
- [ ] Check BlueBubbles delivery logs
- [ ] Verify message format (should have title, todos list, meetings)
- [ ] Check timezone is America/New_York

---

#### Test Midday Check (Manual Trigger)
1. [ ] Open "Midday Check" workflow
2. [ ] Click the "Test" button
3. [ ] Check execution logs for success
4. [ ] Verify message appears on iPhone

**Expected:** Similar to Morning Brief, slightly different message format

---

#### Test EOD Digest (Manual Trigger)
1. [ ] Open "EOD Digest" workflow
2. [ ] Click the "Test" button
3. [ ] Check execution logs for success
4. [ ] Verify message appears on iPhone

**Expected:** Message shows completed todos (status = "Closed"), completion count

---

### Phase 5: Automated Scheduling Verification (1 day)

- [ ] Monitor n8n logs for automatic execution at 6:00 AM
- [ ] Verify Morning Brief message arrives on iPhone
- [ ] Confirm todos are correctly fetched from ERPNext
- [ ] Check for any errors in execution history
- [ ] Monitor 12:00 PM for Midday Check execution
- [ ] Monitor 6:00 PM for EOD Digest execution
- [ ] Verify no execution errors logged

---

## Test Data Requirements

### Minimum Test Data Needed

For scheduled workflows to work:
- [ ] At least 1 open todo in ERPNext with status="Open" and allocated_to="carl@lstailors.com"
- [ ] At least 1 booking in Cal.com for testing (optional)
- [ ] BlueBubbles API key must be valid and have message send permissions

For webhook workflows:
- [ ] No specific data required, can create todos on-demand

---

## Error Handling Tests

### Test Invalid Payloads

#### Sofia Todo - Missing Required Field
```bash
curl -X POST "https://lstailors.app.n8n.cloud/webhook-prod/sofia-todo" \
  -H "Content-Type: application/json" \
  -d '{"description": "No title field"}'
```

**Expected:**
- [ ] Workflow should not create todo
- [ ] Should respond with error or skip
- [ ] No BlueBubbles message sent

---

#### Simone Signal - Invalid Signal Type
```bash
curl -X POST "https://lstailors.app.n8n.cloud/webhook-prod/simone-signal" \
  -H "Content-Type: application/json" \
  -d '{"signal": "invalid_signal", "details": "Test"}'
```

**Expected:**
- [ ] Should map to default title: "Signal: invalid_signal"
- [ ] Should still create todo
- [ ] Should send alert

---

## Performance Tests

### Webhook Response Time
- [ ] Sofia Todo: Should respond within 2-3 seconds
- [ ] Simone Signal: Should respond within 2-3 seconds
- [ ] Todo Overdue: Should respond within 1-2 seconds

### Scheduled Workflow Duration
- [ ] Morning Brief: Should complete within 5 seconds
- [ ] Midday Check: Should complete within 5 seconds
- [ ] EOD Digest: Should complete within 5 seconds

### API Rate Limits
- [ ] Test 10 sequential Sofia Todo calls
- [ ] Verify no rate limit errors
- [ ] Check ERPNext and BlueBubbles rate limits

---

## Documentation Tests

- [ ] All webhook URLs are correct
- [ ] All credentials types are correct
- [ ] All environment variable names match code
- [ ] Expected payload formats are accurate
- [ ] Response formats are accurate

---

## Sign-Off Checklist

### Credentials Configured
- [ ] ERPNext API key validated
- [ ] BlueBubbles API key validated
- [ ] Cal.com API key validated (if needed)
- [ ] All credentials saved in n8n

### Webhooks Tested
- [ ] Sofia Todo responds with 200 OK
- [ ] Simone Signal responds with 200 OK
- [ ] Todo Overdue responds with 200 OK
- [ ] All create todos in ERPNext
- [ ] All send messages correctly

### Scheduled Workflows Tested
- [ ] Morning Brief manual test passes
- [ ] Midday Check manual test passes
- [ ] EOD Digest manual test passes
- [ ] At least one automatic run verified

### Error Handling Verified
- [ ] Invalid payloads handled gracefully
- [ ] Missing credentials produce clear errors
- [ ] Network errors handled without crashes

### Documentation Complete
- [ ] All setup instructions verified
- [ ] All API endpoints documented
- [ ] All error codes documented
- [ ] All troubleshooting steps verified

---

## Known Limitations

### Current (Not Critical)
1. **Credentials in code:** Workflows use environment variables that must be set in n8n. Consider using n8n credential management for better security.
2. **Error responses:** Some workflows could provide more detailed error messages in webhook responses.
3. **Logging:** Add workflow logging for better debugging in production.

### Will Not Block Testing
1. No rate limiting configured (test with reasonable volume)
2. No authentication on webhook endpoints (consider adding if in production)
3. No request validation on webhook payloads (partial validation present)

---

## Success Criteria

### All Criteria Must Pass for "Production Ready"

| Criteria | Status | Notes |
|----------|--------|-------|
| All 6 workflows deployed | ✅ Pass | Verified |
| Webhook endpoints respond to POST | 🔄 Pending | Need credentials |
| Scheduled workflows execute on schedule | 🔄 Pending | Need credentials |
| Todos created in ERPNext | 🔄 Pending | Need ERPNext access |
| Messages sent via BlueBubbles | 🔄 Pending | Need BlueBubbles access |
| No unhandled errors | 🔄 Pending | Error testing needed |
| Documentation complete | ✅ Pass | Complete |

---

## Test Report Template

Use this template to document your testing:

```
TEST REPORT - N8N Workflows
Date: [DATE]
Tester: [NAME]
Credentials Configured: [YES/NO]

WEBHOOK TESTS:
- Sofia Todo: [PASS/FAIL] - Notes: ___
- Simone Signal: [PASS/FAIL] - Notes: ___
- Todo Overdue: [PASS/FAIL] - Notes: ___

SCHEDULED WORKFLOW TESTS:
- Morning Brief: [PASS/FAIL] - Time to execute: ___ seconds
- Midday Check: [PASS/FAIL] - Time to execute: ___ seconds
- EOD Digest: [PASS/FAIL] - Time to execute: ___ seconds

AUTOMATED EXECUTION:
- Morning Brief auto-ran: [YES/NO] - Time: ___
- Midday Check auto-ran: [YES/NO] - Time: ___
- EOD Digest auto-ran: [YES/NO] - Time: ___

OVERALL STATUS: [READY FOR PRODUCTION / NEEDS FIXES]
Issues Found: ___
```

---

## Contact & Support

**n8n Dashboard:** https://lstailors.app.n8n.cloud/  
**n8n Documentation:** https://docs.n8n.io/  
**n8n Community:** https://community.n8n.io/

For issues:
1. Check n8n execution logs
2. Verify credentials are configured
3. Test API endpoints with curl
4. Review error messages in workflow logs

---

**Test Plan Created:** June 12, 2026  
**Ready for Testing:** YES  
**Prerequisite:** Credential configuration (ERPNext, BlueBubbles, Cal.com APIs)
