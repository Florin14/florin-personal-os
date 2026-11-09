import { useMemo, type Key } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { Listing, Observation } from '@/api/shopping';
import { formatMoney } from '@/components/data/format';

import { seriesFor, type Series } from './series';

const SURFACE = '#0b1120';
const INK_MUTED = '#9aa5c7';
const INK_DIM = '#6b7698';
const GRID = 'rgb(120 150 255 / 0.10)';

interface Row {
  t: number;
  /** listing ids observed exactly at this instant (markers are drawn only there) */
  observed: Record<string, { inStock: boolean | null }>;
  [listingId: string]: unknown;
}

function buildRows(history: Observation[], series: Series[], currency: string): Row[] {
  const charted = new Set(series.map((s) => s.listingId));
  const rows: Row[] = [];
  const carried: Record<string, number> = {};
  const points = history
    .filter((o) => charted.has(o.listing_id) && o.currency === currency)
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  for (const o of points) {
    const t = new Date(o.observed_at).getTime();
    carried[o.listing_id] = Number(o.price);
    const last = rows[rows.length - 1];
    const row: Row = last?.t === t ? last : { t, observed: {} };
    if (row !== last) rows.push(row);
    // Prices hold until the next observation: carry every merchant's latest known price.
    Object.assign(row, carried);
    row.observed[o.listing_id] = { inStock: o.in_stock };
  }
  return rows;
}

const dayFormat = new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: 'short' });
const fullFormat = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { payload?: unknown }[];
}

function ChartTooltip({
  active,
  label,
  payload,
  series,
  currency,
}: TooltipProps & { series: Series[]; currency: string }) {
  if (!active || !payload?.length || label === undefined) return null;
  const row = payload[0]?.payload as Row | undefined;
  return (
    <div className="rounded-md border border-line-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 font-mono text-ink-dim">{fullFormat.format(new Date(Number(label)))}</p>
      <ul className="space-y-1">
        {series.map((s) => {
          const value = row?.[s.listingId];
          if (typeof value !== 'number') return null;
          const seen = row?.observed[s.listingId];
          return (
            <li key={s.listingId} className="flex items-center gap-2">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              <span className="text-ink-muted">{s.merchant}</span>
              <span className="ml-auto pl-4 font-mono text-ink tabular-nums">
                {formatMoney(value.toFixed(2), currency)}
              </span>
              {seen?.inStock === false && <span className="text-ink-dim">out of stock</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Price per merchant over time (step-after: a price holds until the next observation). */
export function PriceHistoryChart({
  history,
  listings,
  currency,
  target,
}: {
  history: Observation[];
  listings: Listing[];
  currency: string;
  target: string | null;
}) {
  const series = useMemo(() => seriesFor(listings), [listings]);
  const rows = useMemo(() => buildRows(history, series, currency), [history, series, currency]);
  const hidden = listings.length - series.length;
  const lastIndex = rows.length - 1;

  if (rows.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-ink-dim">
        Record at least two prices to see the history.
      </p>
    );
  }

  const label = (s: Series, showLabel: boolean) =>
    function EndLabel(props: { x?: string | number; y?: string | number; index?: number }) {
      if (!showLabel || props.index !== lastIndex || props.x === undefined || props.y === undefined)
        return null;
      return (
        <text x={Number(props.x) + 10} y={Number(props.y)} dy={4} fill={INK_MUTED} fontSize={11}>
          {s.merchant}
        </text>
      );
    };

  return (
    <figure className="space-y-2">
      {series.length >= 2 && (
        <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          {series.map((s) => (
            <span key={s.listingId} className="inline-flex items-center gap-1.5">
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              {s.merchant}
            </span>
          ))}
          {target && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-4 border-t border-dashed"
                style={{ borderColor: INK_MUTED }}
                aria-hidden
              />
              your target
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full border-2"
              style={{ borderColor: INK_MUTED }}
              aria-hidden
            />
            hollow = out of stock
          </span>
        </figcaption>
      )}
      <div
        className="h-64 w-full"
        role="img"
        aria-label="Price history per merchant; see the comparison table for exact values."
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: series.length <= 4 ? 84 : 16, bottom: 0, left: 4 }}
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) => dayFormat.format(new Date(t))}
              stroke={INK_DIM}
              tick={{ fill: INK_DIM, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={32}
            />
            <YAxis
              width={64}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => v.toLocaleString('ro-RO', { maximumFractionDigits: 0 })}
              tick={{ fill: INK_DIM, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ stroke: INK_DIM, strokeDasharray: '3 3' }}
              content={(p: TooltipProps) => (
                <ChartTooltip {...p} series={series} currency={currency} />
              )}
            />
            {target && (
              <ReferenceLine
                y={Number(target)}
                stroke={INK_MUTED}
                strokeDasharray="5 4"
                ifOverflow="extendDomain"
                label={{
                  value: `target ${formatMoney(target, currency)}`,
                  position: 'insideTopLeft',
                  fill: INK_MUTED,
                  fontSize: 11,
                }}
              />
            )}
            {series.map((s) => (
              <Line
                key={s.listingId}
                dataKey={s.listingId}
                name={s.merchant}
                type="stepAfter"
                stroke={s.color}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls={false}
                label={label(s, series.length <= 4)}
                dot={(props: { cx?: number; cy?: number; payload?: unknown; key?: Key | null }) => {
                  const seen = (props.payload as Row | undefined)?.observed[s.listingId];
                  if (!seen || props.cx === undefined || props.cy === undefined) {
                    return <g key={props.key ?? undefined} />;
                  }
                  return (
                    <circle
                      key={props.key ?? undefined}
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill={seen.inStock === false ? SURFACE : s.color}
                      stroke={seen.inStock === false ? s.color : SURFACE}
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hidden > 0 && (
        <p className="text-xs text-ink-dim">
          {hidden} more merchant{hidden === 1 ? '' : 's'} in the comparison table.
        </p>
      )}
    </figure>
  );
}
