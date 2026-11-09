const RULE_LABELS: Record<string, string> = {
  exact_amount: 'exact amount',
  invoice_number: 'invoice no.',
  name: 'name',
  manual: 'manual',
};

/** Readable chips for a match rule: "auto:exact_amount+name+date_3d" → auto, exact amount, … */
export function ruleChips(rule: string): string[] {
  const [prefix = '', body = ''] = rule.includes(':') ? rule.split(':', 2) : ['', rule];
  const parts = body.split('+').map((part) => {
    const days = /^date_(\d+)d$/.exec(part);
    if (days) return days[1] === '0' ? 'same day' : `≤${days[1] ?? ''} days`;
    return RULE_LABELS[part] ?? part;
  });
  return prefix ? [prefix, ...parts] : parts;
}

export const TARGET_LABELS = { invoice: 'Invoice', document: 'Document', expense: 'Expense' };
