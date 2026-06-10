import { workflow, trigger, node, expr } from 'n8n-workflow';

export const w = workflow('Morning Brief')
  .trigger(
    trigger('Schedule Trigger')
      .type('n8n-nodes-base.cronTrigger')
      .set('expression', '0 6 * * 1,2,3,4,5,6')
      .set('timezone', 'America/New_York')
  )
  .add(
    node('Get Open Todos')
      .type('n8n-nodes-base.httpRequest')
      .set('method', 'GET')
      .set('url', 'https://erp.lstailors.com/api/resource/ToDo')
      .set('sendQuery', true)
      .set('queryParameters', [
        {
          name: 'filters',
          value: JSON.stringify([
            ['ToDo', 'status', '=', 'Open'],
            ['ToDo', 'allocated_to', '=', 'carl@lstailors.com']
          ])
        },
        {
          name: 'fields',
          value: JSON.stringify([
            'name',
            'description',
            'date',
            'priority',
            'lsh_context',
            'reference_type',
            'reference_name',
            'lsh_agent',
            'lsh_comms_source'
          ])
        },
        {
          name: 'limit_page_length',
          value: '50'
        },
        {
          name: 'order_by',
          value: 'priority asc, date asc'
        }
      ])
      .set('authentication', 'predefinedCredentialType')
      .set('nodeCredentialType', 'httpBasicAuth')
      .credential('erpApiKey')
      .to('Schedule Trigger')
  )
  .add(
    node('Get Upcoming Bookings')
      .type('n8n-nodes-base.httpRequest')
      .set('method', 'GET')
      .set('url', 'https://api.cal.com/v1/bookings')
      .set('authentication', 'predefinedCredentialType')
      .set('nodeCredentialType', 'httpHeaderAuth')
      .set('sendQuery', true)
      .set('queryParameters', [
        {
          name: 'status',
          value: 'upcoming'
        },
        {
          name: 'dateFrom',
          value: expr('{{$today}}')
        },
        {
          name: 'dateTo',
          value: expr('{{$today}}')
        }
      ])
      .credential('calApiKey')
      .to('Schedule Trigger')
  )
  .add(
    node('Transform Data')
      .type('n8n-nodes-base.code')
      .set('language', 'javaScript')
      .set('mode', 'runOnceForAllItems')
      .set('jsCode', `
const todos = $input.all()[0]?.json?.data || [];
const bookings = $input.all()[1]?.json?.data || [];

const todosFormatted = todos.map(todo => {
  let priority_emoji = '';
  if (todo.priority === 'High') priority_emoji = '🔴';
  else if (todo.priority === 'Medium') priority_emoji = '🟡';
  else priority_emoji = '🟢';

  return \`\${priority_emoji} [\${todo.priority}] \${todo.name}
   📅 Due: \${todo.date || 'No date'}
   Context: \${todo.lsh_context || 'N/A'}
   Reference: \${todo.reference_type}: \${todo.reference_name}
\`;
}).join('\\n\\n');

const bookingsFormatted = bookings.map(booking => {
  return \`📞 \${booking.title || 'Meeting'}
   ⏰ Time: \${new Date(booking.startTime).toLocaleTimeString()}
   Duration: \${booking.duration}min
   Guest: \${booking.attendees?.[0]?.name || 'TBD'}
\`;
}).join('\\n\\n');

const message = \`
☀️ MORNING BRIEF - \${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}

📋 OPEN TODOS
\${todosFormatted || 'No open todos'}

📅 TODAY'S MEETINGS
\${bookingsFormatted || 'No upcoming meetings'}

---
Generated at \${new Date().toLocaleTimeString()}
\`;

return [{ json: { message } }];
      `)
      .to('Get Open Todos')
      .to('Get Upcoming Bookings')
  )
  .add(
    node('Send BlueBubbles')
      .type('n8n-nodes-base.httpRequest')
      .set('method', 'POST')
      .set('url', 'http://10.0.1.213:1234/api/v1/message/text')
      .set('sendBody', true)
      .set('bodyParametersUi', 'json')
      .set('body', {
        to: 'carl@lstailors.com',
        message: expr('{{$node["Transform Data"].json.message}}')
      })
      .set('sendHeaders', true)
      .set('headerParameters', [
        {
          name: 'X-API-KEY',
          value: expr('{{$env.BLUEBUBBLES_PASSWORD}}')
        }
      ])
      .to('Transform Data')
  );
