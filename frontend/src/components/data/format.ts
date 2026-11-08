const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** "in 3 hours" / "5 minutes ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(0, 'second');
}

export function dateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function duration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return '—';
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = Math.max(end - new Date(startIso).getTime(), 0);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

export function statusLabel(status: string): string {
  const text = status.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Exact sum of decimal strings (money) using integer cents — never floating point. */
export function sumMoney(values: string[]): string {
  let cents = 0n;
  for (const value of values) {
    const negative = value.trim().startsWith('-');
    const [whole = '0', fraction = ''] = value.trim().replace('-', '').split('.');
    const amount = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
    cents += negative ? -amount : amount;
  }
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** "12 345,60 RON" — formats a decimal string without converting to float first. */
export function formatMoney(amount: string, currency: string): string {
  const [whole = '0', fraction = '00'] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped},${fraction.padEnd(2, '0').slice(0, 2)} ${currency}`;
}
