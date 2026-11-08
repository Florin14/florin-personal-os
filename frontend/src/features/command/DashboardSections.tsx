import { Activity, BarChart3, CalendarClock, CheckCheck, ServerCog } from 'lucide-react';
import { Link } from 'react-router';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import { useAuthState } from '@/api/auth';
import { useControls } from '@/api/automation';
import { useHealth, useSystemInfo } from '@/api/system';
import { formatMoney, relativeTime, sumMoney } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Button } from '@/components/ui/button';
import { Badge, Panel, StatusDot } from '@/components/ui/surface';

import type { useCommandData } from './useCommandData';

type Data = ReturnType<typeof useCommandData>;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ViewAll({ to }: { to: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link to={to}>View all</Link>
    </Button>
  );
}

function Approvals({ data }: { data: Data }) {
  const q = data.approvals;
  return (
    <Panel title="Pending approvals" icon={<CheckCheck />} action={<ViewAll to="/approvals" />}>
      {q.isPending ? (
        <LoadingState compact />
      ) : q.isError ? (
        <ErrorState compact error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState compact title="Nothing waiting for you" />
      ) : (
        <ul className="space-y-2">
          {q.data.slice(0, 5).map((a) => (
            <li key={a.id}>
              <Link
                to={`/approvals/${a.id}`}
                className="flex items-center justify-between gap-2 text-sm hover:text-ink"
              >
                <span className="truncate text-ink-muted">{a.title}</span>
                <StatusChip status={a.risk_level} prefix="risk" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Upcoming({ data }: { data: Data }) {
  const tasks = data.tasks.data ?? [];
  const events = data.calendar.data?.connected ? data.calendar.data.events : [];
  const items = [
    ...events
      .slice(0, 4)
      .map((e) => ({ id: e.id, label: e.summary, when: relativeTime(e.start), kind: 'event' })),
    ...tasks.slice(0, 4).map((t) => ({
      id: t.id,
      label: t.title,
      when: t.scheduled_start ? relativeTime(t.scheduled_start) : 'unscheduled',
      kind: 'task',
    })),
  ];
  return (
    <Panel title="Upcoming" icon={<CalendarClock />} action={<ViewAll to="/calendar" />}>
      {data.tasks.isPending ? (
        <LoadingState compact />
      ) : items.length === 0 ? (
        <EmptyState compact title="No upcoming tasks or events" />
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li
              key={`${i.kind}-${i.id}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge tone={i.kind === 'event' ? 'info' : 'electric'}>{i.kind}</Badge>
                <span className="truncate text-ink-muted">{i.label}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-dim">{i.when}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Financial({ data }: { data: Data }) {
  const rows = data.expenses.data ?? [];
  const currency = rows[0]?.currency ?? 'RON';
  const byMonth = MONTHS.map((label, i) => {
    const total = sumMoney(
      rows.filter((r) => r.month === i + 1 && r.currency === currency).map((r) => r.total),
    );
    // Number() is used only to size chart bars; amounts shown to the user stay exact.
    return { label, total, value: Number(total) };
  });
  const yearTotal = sumMoney(rows.filter((r) => r.currency === currency).map((r) => r.total));
  const issued = (data.invoices.data ?? []).filter((i) => i.status === 'issued');
  return (
    <Panel title="Financial overview" icon={<BarChart3 />} action={<ViewAll to="/finance" />}>
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1">
        <div>
          <p className="label-caps">Expenses {new Date().getFullYear()}</p>
          <p className="font-display text-lg font-semibold tabular-nums">
            {formatMoney(yearTotal, currency)}
          </p>
        </div>
        <div>
          <p className="label-caps">Invoices issued</p>
          <p className="font-display text-lg font-semibold tabular-nums">{issued.length}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-dim">No expenses recorded this year.</p>
      ) : (
        <div className="h-28" role="img" aria-label={`Monthly expenses in ${currency}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byMonth} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: '#6b7698', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgb(79 125 255 / 0.08)' }}
                contentStyle={{
                  background: '#10182c',
                  border: '1px solid rgb(120 150 255 / 0.24)',
                  borderRadius: 6,
                }}
                formatter={(_value, _name, item) => [
                  formatMoney(String((item.payload as { total: string }).total), currency),
                  'Expenses',
                ]}
              />
              <Bar dataKey="value" fill="url(#pos-bar)" radius={[3, 3, 0, 0]} />
              <defs>
                <linearGradient id="pos-bar" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#2fd6f0" />
                  <stop offset="1" stopColor="#4f7dff" stopOpacity="0.5" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function ActivityFeed({ data }: { data: Data }) {
  const names = new Map((data.automations.data ?? []).map((a) => [a.id, a.name]));
  const q = data.executions;
  return (
    <Panel title="Automation activity" icon={<Activity />} action={<ViewAll to="/executions" />}>
      {q.isPending ? (
        <LoadingState compact />
      ) : q.isError ? (
        <ErrorState compact error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState compact title="No executions yet" />
      ) : (
        <ul className="space-y-2">
          {q.data.slice(0, 6).map((e) => (
            <li key={e.id}>
              <Link
                to={`/executions/${e.id}`}
                className="flex items-center justify-between gap-2 text-sm hover:text-ink"
              >
                <span className="truncate text-ink-muted">
                  {names.get(e.automation_id) ?? 'Automation'}
                  <span className="ml-2 font-mono text-[11px] text-ink-dim">
                    {relativeTime(e.created_at)}
                  </span>
                </span>
                <StatusChip status={e.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SystemStatus({ data }: { data: Data }) {
  const health = useHealth();
  const info = useSystemInfo();
  const controls = useControls();
  const { data: auth } = useAuthState();
  const integrations = data.connections.data ?? [];
  const rows: {
    label: string;
    tone: 'success' | 'danger' | 'warning' | 'neutral';
    value: string;
  }[] = [
    {
      label: 'API',
      tone: health.isError ? 'danger' : 'success',
      value: health.isError ? 'Unreachable' : 'Online',
    },
    {
      label: 'Database',
      tone: health.data?.database === 'ok' ? 'success' : 'danger',
      value: health.data?.database === 'ok' ? 'Connected' : 'Unavailable',
    },
    {
      label: 'Emergency stop',
      tone: controls.data?.emergency_stop ? 'danger' : 'success',
      value: controls.data?.emergency_stop ? 'ACTIVE' : 'Off',
    },
    ...integrations.map((c) => ({
      label: c.name,
      tone: (c.status === 'active' ? 'success' : c.status === 'error' ? 'danger' : 'neutral') as
        'success' | 'danger' | 'neutral',
      value: c.status,
    })),
  ];
  return (
    <Panel
      title="System status"
      icon={<ServerCog />}
      action={
        info.data ? (
          <span className="font-mono text-[11px] text-ink-dim">
            v{info.data.version} · {info.data.environment}
          </span>
        ) : undefined
      }
    >
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ink-muted">
              <StatusDot tone={r.tone} />
              {r.label}
            </span>
            <span className="font-mono text-[11px] text-ink-dim uppercase">{r.value}</span>
          </li>
        ))}
      </ul>
      {integrations.length === 0 && (
        <p className="mt-2 text-xs text-ink-dim">
          No integrations connected.{' '}
          {auth?.user.is_admin ? 'Connect Oblio, Google or Discord in Integrations.' : ''}
        </p>
      )}
    </Panel>
  );
}

export function DashboardSections({ data }: { data: Data }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Approvals data={data} />
      <Upcoming data={data} />
      <Financial data={data} />
      <ActivityFeed data={data} />
      <SystemStatus data={data} />
    </div>
  );
}
