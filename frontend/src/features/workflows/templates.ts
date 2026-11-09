/** Starter workflow definitions shown in the builder. */
export const TEMPLATES: { id: string; label: string; definition: Record<string, unknown> }[] = [
  {
    id: 'scheduled-reminder',
    label: 'Scheduled reminder',
    definition: {
      triggers: [
        { type: 'cron', key: 'monthly', expression: '0 9 1 * *', timezone: 'Europe/Bucharest' },
        { type: 'manual' },
      ],
      steps: [
        {
          key: 'remind',
          type: 'notify',
          message_title: 'Monthly checklist',
          message_body: 'Time to review invoices and expenses for the previous month.',
          severity: 'info',
        },
      ],
    },
  },
  {
    id: 'approval-gate',
    label: 'Approval before continuing',
    definition: {
      triggers: [{ type: 'manual' }],
      steps: [
        {
          key: 'prepare',
          type: 'action',
          action: 'core.set_values',
          params: { values: { amount: '{{ trigger.amount }}', client: '{{ trigger.client }}' } },
        },
        {
          key: 'confirm',
          type: 'approval',
          approval: {
            risk_level: 'medium',
            title: 'Confirm {{ steps.prepare.values.client }}',
            summary: 'Amount {{ steps.prepare.values.amount }}',
            expires_in_minutes: 1440,
          },
        },
        {
          key: 'done',
          type: 'notify',
          message_title: 'Confirmed for {{ steps.prepare.values.client }}',
        },
      ],
    },
  },
  {
    id: 'threshold-branch',
    label: 'Branch on a threshold',
    definition: {
      triggers: [{ type: 'manual' }],
      steps: [
        {
          key: 'check',
          type: 'condition',
          conditions: [{ left: 'trigger.amount', op: 'gt', right: '1000' }],
          on_false: 'log_small',
        },
        {
          key: 'alert',
          type: 'notify',
          message_title: 'Large amount: {{ trigger.amount }}',
          severity: 'warning',
          next: 'end',
        },
        {
          key: 'log_small',
          type: 'action',
          action: 'core.log',
          params: { message: 'small amount' },
        },
      ],
    },
  },
  {
    id: 'approve-before-buying',
    label: 'Approve before buying (price alert)',
    definition: {
      // Event triggers receive { event_type, event: <payload> }.
      triggers: [{ type: 'event', key: 'price_alert', event_type: 'shopping.price_alert' }],
      steps: [
        {
          key: 'at_target',
          type: 'condition',
          conditions: [{ left: 'trigger.event.kind', op: 'eq', right: 'below_target' }],
          on_false: 'end',
        },
        {
          key: 'decide',
          type: 'action',
          action: 'shopping.approve_purchase',
          params: {
            product_id: '{{ trigger.event.product_id }}',
            price: '{{ trigger.event.price }}',
          },
          approval: {
            risk_level: 'medium',
            title: 'Buy {{ trigger.event.product_name }}?',
            summary:
              '{{ trigger.event.price }} {{ trigger.event.currency }} at {{ trigger.event.merchant }}',
            expires_in_minutes: 2880,
          },
        },
        {
          key: 'reminder',
          type: 'notify',
          message_title: 'Decision recorded: buy {{ trigger.event.product_name }}',
          message_body:
            'Nothing was ordered. Buy it at {{ trigger.event.merchant }}, then mark it purchased.',
          severity: 'success',
        },
      ],
    },
  },
];
