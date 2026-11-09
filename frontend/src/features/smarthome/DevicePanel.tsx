import { Settings2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import { useConfigureHomeDevice, useHomeCommand, type HomeDevice } from '@/api/smarthome';
import { dateTime, statusLabel } from '@/components/data/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, SwitchField } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Badge, Panel } from '@/components/ui/surface';
import { useNow } from '@/hooks/useNow';

function attributeValue(value: unknown): string {
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === 'string').join(', ');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '—';
}

function DevicePolicy({
  device,
  workspaceId,
  onClose,
}: {
  device: HomeDevice;
  workspaceId: string;
  onClose: () => void;
}) {
  const save = useConfigureHomeDevice(workspaceId);
  const [controllable, setControllable] = useState(device.controllable);
  const [interval, setInterval] = useState(String(device.min_interval_seconds));
  const [override, setOverride] = useState('keep');
  const seconds = Number(interval);
  const valid = Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600;
  const submit = () =>
    save.mutate(
      {
        deviceId: device.id,
        body: {
          controllable,
          min_interval_seconds: seconds,
          override_until:
            override === 'keep'
              ? device.override_until
              : override === 'clear'
                ? null
                : new Date(Date.now() + Number(override) * 3600_000).toISOString(),
        },
      },
      { onSuccess: onClose },
    );
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Controls · ${device.name}`}
      description="Choose what this device may do. Changes apply to this workspace only."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={submit}>
            Save policy
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SwitchField
          label="Allow device controls"
          checked={controllable}
          onCheckedChange={setControllable}
          disabled={!device.services.length}
        />
        {!device.services.length && <p className="text-xs text-ink-dim">Sensors are read-only.</p>}
        <Field
          label="Minimum time between commands (seconds)"
          help="10–3600 seconds. The hourly limit is 20 commands."
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={10}
              max={3600}
              step={1}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Pause automations"
          help="Manual controls remain available while automations are paused."
        >
          {(p) => (
            <Select {...p} value={override} onChange={(e) => setOverride(e.target.value)}>
              <option value="keep">Keep current setting</option>
              <option value="clear">Resume automations</option>
              <option value="1">Pause for 1 hour</option>
              <option value="8">Pause for 8 hours</option>
              <option value="24">Pause for 24 hours</option>
            </Select>
          )}
        </Field>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      </div>
    </Modal>
  );
}

export function DevicePanel({
  device,
  workspaceId,
  canManage,
  canControl,
  connected,
  onClose,
}: {
  device: HomeDevice;
  workspaceId: string;
  canManage: boolean;
  canControl: boolean;
  connected: boolean;
  onClose: () => void;
}) {
  const command = useHomeCommand(workspaceId);
  const now = useNow(1000);
  const [service, setService] = useState(device.services[0] ?? '');
  const [value, setValue] = useState('22');
  const [policy, setPolicy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const modes = Array.isArray(device.attributes.hvac_modes)
    ? device.attributes.hvac_modes.filter((v): v is string => typeof v === 'string')
    : [];
  const cooldown = Math.max(
    0,
    Math.ceil(
      ((device.last_command_at ? new Date(device.last_command_at).getTime() : 0) +
        device.min_interval_seconds * 1000 -
        now) /
        1000,
    ),
  );
  const paused = Boolean(device.override_until && new Date(device.override_until).getTime() > now);
  const needsConfirmation = device.sensitive_services.includes(service);
  const send = (confirmed = false) => {
    if (needsConfirmation && !confirmed) {
      setConfirm(true);
      return;
    }
    const data: Record<string, unknown> =
      service === 'set_temperature'
        ? { temperature: Number(value) }
        : service === 'volume_set'
          ? { volume_level: Number(value) }
          : service === 'set_hvac_mode'
            ? { hvac_mode: value }
            : {};
    command.mutate({
      deviceId: device.id,
      body: {
        service,
        data,
        idempotency_key: crypto.randomUUID(),
        confirm_sensitive: confirmed,
      },
    });
    setConfirm(false);
  };
  const numeric = service === 'set_temperature' || service === 'volume_set';
  const valid =
    !numeric ||
    (value.trim() !== '' &&
      Number.isFinite(Number(value)) &&
      (service === 'set_temperature'
        ? Number(value) >= 5 && Number(value) <= 35
        : Number(value) >= 0 && Number(value) <= 1));
  return (
    <>
      <Modal
        open
        onOpenChange={(open) => !open && onClose()}
        title={device.name}
        description={device.entity_id}
        size="lg"
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={device.available ? 'success' : 'danger'} dot>
              {device.available ? device.state : 'Unavailable'}
            </Badge>
            <Badge tone={device.controllable ? 'info' : 'neutral'}>
              {device.controllable ? 'Controls enabled' : 'Read-only'}
            </Badge>
            {paused && <Badge tone="warning">Automations paused</Badge>}
          </div>
          {paused && (
            <Alert tone="warning">
              Automations paused until {dateTime(device.override_until)}. Manual commands remain
              available.
            </Alert>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(device.attributes)
              .filter(([key]) => key !== 'friendly_name')
              .map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-xs text-ink-dim">{statusLabel(key)}</dt>
                  <dd className="mt-1 break-words text-ink-muted">{attributeValue(value)}</dd>
                </div>
              ))}
          </dl>
          <Panel title="Manual control" icon={<ShieldCheck />}>
            <div className="space-y-3">
              {!device.controllable && (
                <p className="text-sm text-ink-muted">
                  This device is read-only. An administrator can enable controls below.
                </p>
              )}
              {!connected && (
                <Alert tone="warning">Reconnect Home Assistant before sending commands.</Alert>
              )}
              {device.services.length > 0 ? (
                <>
                  <Field label="Command">
                    {(p) => (
                      <Select
                        {...p}
                        value={service}
                        onChange={(e) => {
                          setService(e.target.value);
                          command.reset();
                          setValue(
                            e.target.value === 'volume_set'
                              ? '0.3'
                              : e.target.value === 'set_hvac_mode'
                                ? (modes[0] ?? '')
                                : '22',
                          );
                        }}
                      >
                        {device.services.map((s) => (
                          <option key={s} value={s}>
                            {statusLabel(s)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {numeric && (
                    <Field
                      label={service === 'volume_set' ? 'Volume (0–1)' : 'Target temperature (°C)'}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          min={service === 'volume_set' ? 0 : 5}
                          max={service === 'volume_set' ? 1 : 35}
                          step={service === 'volume_set' ? 0.05 : 0.5}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {service === 'set_hvac_mode' && (
                    <Field label="HVAC mode">
                      {(p) => (
                        <Select {...p} value={value} onChange={(e) => setValue(e.target.value)}>
                          {modes.map((mode) => (
                            <option key={mode} value={mode}>
                              {statusLabel(mode)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )}
                  {needsConfirmation && (
                    <p className="text-xs text-warning">
                      Manual confirmation required. This service is never available to automations.
                    </p>
                  )}
                  <Button
                    variant={needsConfirmation ? 'danger' : 'primary'}
                    loading={command.isPending}
                    disabled={
                      !canControl ||
                      !device.controllable ||
                      !device.available ||
                      !connected ||
                      cooldown > 0 ||
                      !valid
                    }
                    onClick={() => send()}
                  >
                    {cooldown > 0 ? `Cooldown · ${cooldown}s` : 'Send command'}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-ink-dim">This sensor has no supported commands.</p>
              )}
              {command.isError && (
                <Alert tone="danger">
                  {errorMessage(command.error)} Check the command log before trying again.
                </Alert>
              )}
              {command.data && (
                <Alert tone={command.data.status === 'succeeded' ? 'success' : 'warning'}>
                  {command.data.message}
                </Alert>
              )}
            </div>
          </Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-dim">
              Last seen {dateTime(device.last_seen_at)} · {device.min_interval_seconds}s cooldown ·
              20 commands/hour
            </p>
            {canManage && (
              <Button variant="secondary" onClick={() => setPolicy(true)}>
                <Settings2 /> Device policy
              </Button>
            )}
          </div>
        </div>
      </Modal>
      {policy && (
        <DevicePolicy device={device} workspaceId={workspaceId} onClose={() => setPolicy(false)} />
      )}
      {confirm && (
        <Modal
          open
          onOpenChange={setConfirm}
          title="Confirm sensitive command"
          description={`${statusLabel(service)} · ${device.name}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => send(true)} loading={command.isPending}>
                Confirm command
              </Button>
            </>
          }
        >
          <Alert tone="warning">
            This changes a security-sensitive device. Confirm that you intend to send this command
            now.
          </Alert>
        </Modal>
      )}
    </>
  );
}
