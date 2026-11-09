import {
  Activity,
  Home,
  Lightbulb,
  LockKeyhole,
  Plug,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Thermometer,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/api/client';
import { useCreateConnection } from '@/api/integrations';
import { useHomeCommands, useHomeDevices, useHomeStatus, useSyncHome } from '@/api/smarthome';
import { dateTime, statusLabel } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Panel, Table, Td, Th } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useNow } from '@/hooks/useNow';

import { DevicePanel } from './DevicePanel';

const ICONS: Record<string, LucideIcon | undefined> = {
  light: Lightbulb,
  lock: LockKeyhole,
  climate: Thermometer,
};

export default function SmartHomePage() {
  const workspace = useCurrentWorkspace();
  const devices = useHomeDevices(workspace?.id);
  const commands = useHomeCommands(workspace?.id);
  const status = useHomeStatus(workspace?.id);
  const now = useNow(1000);
  const sync = useSyncHome(workspace?.id);
  const connect = useCreateConnection();
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const connected = status.data?.connected ?? false;
  const mock = status.data?.mode === 'mock';
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';
  const canControl = Boolean(workspace && workspace.role !== 'viewer');
  if (!workspace || devices.isPending || status.isPending)
    return <LoadingState label="Loading your home…" />;
  if (devices.isError || status.isError)
    return (
      <ErrorState
        error={devices.error ?? status.error}
        onRetry={() => {
          void devices.refetch();
          void status.refetch();
        }}
      />
    );
  const all = devices.data;
  const filtered = all.filter(
    (d) =>
      (domain === 'all' || d.domain === domain) &&
      `${d.name} ${d.entity_id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const device = all.find((d) => d.id === selected);
  const paused = all.filter(
    (d) => d.override_until && new Date(d.override_until).getTime() > now,
  ).length;
  const startMock = () =>
    connect.mutate(
      {
        provider: 'home_assistant',
        workspace_id: workspace.id,
        name: 'Home Assistant (mock)',
        config: { mode: 'mock' },
        secrets: {},
      },
      { onSuccess: () => sync.mutate() },
    );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="LIFE SYSTEMS / LOCAL CONTROL"
        title="Smart Home"
        subtitle={`Your devices, on your terms. ${workspace.name} · Home Assistant`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/integrations">
                <Plug /> Integrations
              </Link>
            </Button>
            <Button
              variant="primary"
              onClick={() => sync.mutate()}
              loading={sync.isPending}
              disabled={!connected || !canControl}
            >
              <RefreshCw /> Sync devices
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge dot tone={connected ? 'success' : 'warning'}>
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
        {mock && <Badge tone="violet">Mock home · simulated devices</Badge>}
        <span className="text-xs text-ink-dim">
          {connected
            ? 'State refreshes every minute.'
            : 'Connect Home Assistant to discover devices.'}
        </span>
      </div>
      {(sync.error ?? connect.error) && (
        <Alert tone="danger">{errorMessage(sync.error ?? connect.error)}</Alert>
      )}
      {sync.isSuccess && (
        <Alert tone="success">Synced {sync.data.devices} supported devices.</Alert>
      )}
      {!connected && (
        <Panel title="Connect your home" icon={<Home />}>
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              Add your local Home Assistant connection in Integrations. You can explore a simulated
              home without a token or real devices.
            </p>
            {!status.data.configured && canManage && (
              <Button
                variant="primary"
                loading={connect.isPending || sync.isPending}
                onClick={startMock}
              >
                Try mock home
              </Button>
            )}
          </div>
        </Panel>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Devices discovered', value: all.length, Icon: Home },
          {
            label: 'Controls enabled',
            value: all.filter((d) => d.controllable).length,
            Icon: ShieldCheck,
          },
          { label: 'Automations paused', value: paused, Icon: SlidersHorizontal },
        ].map(({ label, value, Icon }) => (
          <Panel key={label}>
            <div className="flex items-center gap-3">
              <Icon className="size-5 text-cyan" />
              <div>
                <p className="font-display text-2xl font-semibold">{value}</p>
                <p className="text-xs text-ink-muted">{label}</p>
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <Field label="Search devices">
          {(p) => (
            <Input
              {...p}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or entity ID"
            />
          )}
        </Field>
        <Field label="Device type">
          {(p) => (
            <Select {...p} value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="all">All types</option>
              {[...new Set(all.map((d) => d.domain))].sort().map((d) => (
                <option key={d} value={d}>
                  {statusLabel(d)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          title={all.length ? 'No matching devices' : 'No devices discovered'}
          description={
            all.length
              ? 'Try another search or device type.'
              : 'Connect Home Assistant and sync devices. New devices start in read-only mode.'
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((d) => {
            const Icon = ICONS[d.domain] ?? Home;
            const unit =
              typeof d.attributes.unit_of_measurement === 'string'
                ? d.attributes.unit_of_measurement
                : '';
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(d.id)}
                className="glass group rounded-lg p-4 text-left transition-colors hover:border-electric/50 focus-visible:outline-2 focus-visible:outline-electric"
              >
                <div className="mb-4 flex items-center justify-between gap-2">
                  <Icon className="size-5 text-cyan" />
                  <Badge tone={!d.available ? 'danger' : d.controllable ? 'info' : 'neutral'}>
                    {!d.available
                      ? 'Unavailable'
                      : d.controllable
                        ? 'Controls enabled'
                        : 'Read-only'}
                  </Badge>
                </div>
                <h2 className="font-display text-sm font-semibold group-hover:text-electric-soft">
                  {d.name}
                </h2>
                <p className="mt-1 truncate font-mono text-[11px] text-ink-dim">{d.entity_id}</p>
                <p className="mt-3 text-lg text-ink">
                  {statusLabel(d.state)}
                  {unit && ` ${unit}`}
                </p>
                {d.override_until && new Date(d.override_until).getTime() > now && (
                  <p className="mt-2 text-xs text-warning">Automations paused</p>
                )}
              </button>
            );
          })}
        </div>
      )}
      <Panel title="Command log" icon={<Activity />}>
        {commands.isPending ? (
          <LoadingState />
        ) : commands.isError ? (
          <ErrorState error={commands.error} onRetry={() => void commands.refetch()} />
        ) : commands.data.length === 0 ? (
          <p className="py-5 text-center text-sm text-ink-dim">
            No commands yet. Every attempted command appears here, including refusals.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Device / command</Th>
                <Th>Outcome</Th>
                <Th>Source</Th>
                <Th>Time</Th>
              </tr>
            </thead>
            <tbody>
              {commands.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <p className="font-medium">{c.entity_id}</p>
                    <p className="text-xs text-ink-dim">{statusLabel(c.service)}</p>
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        c.status === 'succeeded'
                          ? 'success'
                          : c.status === 'failed'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {c.status}
                    </Badge>
                    <p className="mt-1 max-w-sm text-xs text-ink-muted">
                      {c.message || 'Awaiting confirmation. Verify device state before retrying.'}
                    </p>
                  </Td>
                  <Td>{statusLabel(c.source)}</Td>
                  <Td className="whitespace-nowrap">{dateTime(c.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {device && (
        <DevicePanel
          key={`${workspace.id}:${device.id}`}
          device={device}
          workspaceId={workspace.id}
          canManage={canManage}
          canControl={canControl}
          connected={connected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
