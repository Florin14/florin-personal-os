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
];
