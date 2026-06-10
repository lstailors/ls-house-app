import { workflow, node, trigger, expr, ifElse, newCredential } from '@n8n/workflow-sdk';

const webhookTrigger = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook Trigger',
    parameters: {
      httpMethod: 'POST',
      path: 'todo-overdue',
      responseMode: 'responseNode'
    }
  },
  output: [{
    status: 'Open',
    description: 'Complete project proposal',
    context: 'Q2 Planning',
    due: '2026-06-08',
    priority: 'High',
    agent: 'Maestro',
    chatGuid: 'iMessage;+;user@example.com'
  }]
});

const checkStatus = ifElse({
  version: 2.2,
  config: {
    name: 'Check Status Open',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict'
        },
        conditions: [
          {
            leftValue: expr('{{ $json.status }}'),
            operator: { type: 'string', operation: 'equals' },
            rightValue: 'Open'
          }
        ],
        combinator: 'and'
      }
    }
  }
});

const sendRaven = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send Raven Message',
    parameters: {
      method: 'POST',
      url: 'https://erp.lstailors.com/api/resource/Raven Message',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpBasicAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: {
        channel_id: 'L&S Tailors-todos',
        text: expr('🚨 OVERDUE: {{ $json.description }} · context: {{ $json.context }} · was due {{ $json.due }}'),
        message_type: 'Text',
        is_bot_message: 1,
        bot: 'Maestro-Raven'
      }
    },
    credentials: {
      httpBasicAuth: newCredential('ERP API Key')
    },
    output: [{ ok: true }]
  }
});

const sendBlueBubbles = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send BlueBubbles Alert',
    parameters: {
      method: 'POST',
      url: 'http://10.0.1.213:1234/api/v1/message/text',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: {
        chatGuid: expr('{{ $("Webhook Trigger").item.json.chatGuid }}'),
        message: expr('🚨 Overdue todo: {{ $("Webhook Trigger").item.json.description }} ({{ $("Webhook Trigger").item.json.context }}) — was due {{ $("Webhook Trigger").item.json.due }}'),
        method: 'apple-script'
      },
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'Password',
            value: expr('{{ $env.BLUEBUBBLES_PASSWORD }}')
          }
        ]
      }
    },
    output: [{ ok: true }]
  }
});

const respondSuccess = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Success',
    parameters: {
      respondWith: 'json',
      responseBody: { status: 'alerted' }
    },
    output: [{ status: 'alerted' }]
  }
});

export default workflow('todo-overdue-alert', 'Todo Overdue Alert')
  .add(webhookTrigger)
  .to(
    checkStatus.onTrue(
      sendRaven.to(sendBlueBubbles.to(respondSuccess))
    )
  );
