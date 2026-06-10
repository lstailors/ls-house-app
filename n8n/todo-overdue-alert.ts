import { workflow, trigger, node, expr } from 'n8n-workflow';

export const w = workflow('Todo Overdue Alert')
  .trigger(
    trigger('Webhook Trigger')
      .type('n8n-nodes-base.webhook')
      .set('httpMethod', 'POST')
      .set('path', 'todo-overdue')
      .set('responseMode', 'responseNode')
  )
  .add(
    node('Check Status')
      .type('n8n-nodes-base.if')
      .set('conditions', {
        string: [
          {
            value1: expr('{{$json.status}}'),
            operation: 'equals',
            value2: 'Open',
          }
        ]
      })
      .to('Webhook Trigger')
  )
  .add(
    node('Send Raven Message')
      .type('n8n-nodes-base.httpRequest')
      .set('method', 'POST')
      .set('url', 'https://erp.lstailors.com/api/resource/Raven Message')
      .set('authentication', 'genericCredentialType')
      .set('genericAuthType', 'httpCustomAuth')
      .set('sendHeaders', true)
      .set('headerParameters', [
        {
          name: 'Authorization',
          value: expr('Bearer {{$env.ERP_API_KEY}}:{{$env.ERP_API_SECRET}}')
        }
      ])
      .set('sendBody', true)
      .set('bodyParametersUi', 'json')
      .set('body', {
        channel_id: 'L&S Tailors-todos',
        text: expr('🚨 OVERDUE: {{$json.description}} · context: {{$json.context}} · was due {{$json.due}}'),
        message_type: 'Text',
        is_bot_message: 1,
        bot: 'Maestro-Raven',
      })
      .to('Check Status')
  )
  .add(
    node('Send BlueBubbles')
      .type('n8n-nodes-base.httpRequest')
      .set('method', 'POST')
      .set('url', 'http://10.0.1.213:1234/api/v1/message/text')
      .set('sendHeaders', true)
      .set('headerParameters', [
        {
          name: 'Authorization',
          value: expr('{{$env.BLUEBUBBLES_PASSWORD}}')
        }
      ])
      .set('sendBody', true)
      .set('bodyParametersUi', 'json')
      .set('body', {
        chatGuid: expr('{{$json.chatGuid}}'),
        message: expr('🚨 Overdue todo: {{$json.description}} ({{$json.context}}) — was due {{$json.due}}'),
        method: 'apple-script',
      })
      .to('Send Raven Message')
  )
  .add(
    node('Respond to Webhook')
      .type('n8n-nodes-base.respondToWebhook')
      .set('respondWith', 'json')
      .set('responseBody', { status: 'alerted' })
      .to('Send BlueBubbles')
  );
