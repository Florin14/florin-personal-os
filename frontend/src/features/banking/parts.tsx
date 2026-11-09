import { formatMoney } from '@/components/data/format';
import { cn } from '@/lib/cn';

/** Signed money: incoming green with a plus sign, outgoing in the default ink. */
export function SignedAmount({
  amount,
  currency,
  className,
}: {
  amount: string;
  currency: string;
  className?: string;
}) {
  const incoming = !amount.startsWith('-');
  return (
    <span
      className={cn(
        'font-mono whitespace-nowrap tabular-nums',
        incoming ? 'text-success' : 'text-ink',
        className,
      )}
    >
      {incoming ? '+' : ''}
      {formatMoney(amount, currency)}
    </span>
  );
}

/** Match confidence 0–1 as a labelled meter (exact rules, never a guess). */
export function ConfidenceMeter({ value }: { value: string }) {
  const percent = Math.round(Number(value) * 100);
  const tone = percent >= 95 ? 'bg-success' : percent >= 70 ? 'bg-cyan' : 'bg-warning';
  return (
    <span className="inline-flex items-center gap-2" title={`Confidence ${String(percent)}%`}>
      <span
        className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Match confidence"
      >
        <span
          className={cn('block h-full rounded-full', tone)}
          style={{ width: `${String(percent)}%` }}
        />
      </span>
      <span className="font-mono text-xs text-ink-muted tabular-nums">{percent}%</span>
    </span>
  );
}
