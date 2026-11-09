import { ExternalLink, Plug } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { useAuthState } from '@/api/auth';
import { errorMessage } from '@/api/client';
import {
  useCheckConnection,
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useProviders,
  useUpdateConnection,
  type Connection,
  type Provider,
} from '@/api/integrations';
import { useGoogleAuthorize, useGoogleDisconnect } from '@/api/workspaceData';
import { dateTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Badge, Panel } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

import { SchemaFields } from './SchemaFields';
import { initialValues, toPayload, type FieldValues, type ObjectSchema } from './schemaValues';

type DialogMode =
  | { kind: 'connect'; provider: Provider }
  | { kind: 'edit'; provider: Provider; connection: Connection };

function ConnectionDialog({ mode, onClose }: { mode: DialogMode; onClose: () => void }) {
  const workspace = useCurrentWorkspace();
  const create = useCreateConnection();
  const update = useUpdateConnection();
  const schema = mode.provider.config_schema as ObjectSchema;
  const editing = mode.kind === 'edit';
  const [values, setValues] = useState<FieldValues>(() =>
    initialValues(schema, editing ? mode.connection.config : undefined),
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = editing ? update : create;
  const systemScope = mode.provider.scope === 'system';

  const submit = () => {
    setLocalError(null);
    let config: Record<string, unknown>;
    try {
      config = toPayload(schema, values);
    } catch {
      setLocalError('One of the JSON fields is not valid JSON.');
      return;
    }
    const filled = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== ''));
    if (editing) {
      update.mutate(
        { id: mode.connection.id, config, secrets: Object.keys(filled).length ? filled : null },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        {
          provider: mode.provider.key,
          workspace_id: systemScope ? null : (workspace?.id ?? null),
          name: mode.provider.title,
          config,
          secrets: filled,
        },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? `Edit ${mode.provider.title}` : `Connect ${mode.provider.title}`}
      description={`${systemScope ? 'System-wide integration (administrators only).' : `Connected to “${workspace?.name ?? ''}”.`} Secrets are encrypted and can never be read back.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Connect'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SchemaFields
          schema={schema}
          values={values}
          onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
        />
        {mode.provider.secret_fields.map((field) => (
          <Field
            key={field}
            label={editing ? `${field} (leave empty to keep)` : field}
            required={!editing}
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="off"
                value={secrets[field] ?? ''}
                onChange={(e) => setSecrets((s) => ({ ...s, [field]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        {(localError ?? mutation.error) && (
          <Alert tone="danger">{localError ?? errorMessage(mutation.error)}</Alert>
        )}
      </div>
    </Modal>
  );
}

const FEATURES = [
  { key: 'calendar', label: 'Calendar (events, reminders, free/busy)' },
  { key: 'gmail', label: 'Gmail (read-only: invoice/receipt attachments)' },
  { key: 'drive', label: 'Drive (only files created by Personal OS)' },
] as const;

function GoogleConnect({ connection }: { connection: Connection | undefined }) {
  const workspace = useCurrentWorkspace();
  const authorize = useGoogleAuthorize();
  const disconnect = useGoogleDisconnect();
  const [features, setFeatures] = useState<('calendar' | 'gmail' | 'drive')[]>(['calendar']);
  if (!workspace) return null;
  if (connection) {
    const cfg = connection.config as {
      account_email?: string;
      features?: string[];
      mock?: boolean;
    };
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-muted">
          {cfg.account_email} · {(cfg.features ?? []).join(', ')}{' '}
          {cfg.mock && <Badge tone="violet">mock</Badge>}
        </p>
        <Button
          size="sm"
          variant="danger"
          onClick={() => disconnect.mutate(workspace.id)}
          loading={disconnect.isPending}
        >
          Disconnect & revoke
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="label-caps mb-1">Grant access to</legend>
        {FEATURES.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-sm text-ink-muted">
            <Checkbox
              checked={features.includes(f.key)}
              onCheckedChange={(v) =>
                setFeatures((s) => (v ? [...s, f.key] : s.filter((x) => x !== f.key)))
              }
            />
            {f.label}
          </label>
        ))}
      </fieldset>
      {authorize.isError && <Alert tone="danger">{errorMessage(authorize.error)}</Alert>}
      <Button
        variant="primary"
        size="sm"
        disabled={features.length === 0}
        loading={authorize.isPending}
        onClick={() =>
          authorize.mutate(
            { workspace_id: workspace.id, features },
            { onSuccess: (r) => window.location.assign(r.url) },
          )
        }
      >
        Connect with Google
      </Button>
    </div>
  );
}

function ProviderCard({
  provider,
  connection,
  canManage,
  onOpen,
}: {
  provider: Provider;
  connection: Connection | undefined;
  canManage: boolean;
  onOpen: (m: DialogMode) => void;
}) {
  const check = useCheckConnection();
  const update = useUpdateConnection();
  const remove = useDeleteConnection();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const error = check.error ?? update.error ?? remove.error;
  const isGoogleAccount = provider.key === 'google';
  return (
    <Panel
      title={provider.title}
      icon={<Plug />}
      action={connection ? <StatusChip status={connection.status} /> : <Badge>not connected</Badge>}
    >
      <p className="text-sm text-ink-muted">{provider.description}</p>
      <div className="my-3 flex flex-wrap gap-1.5">
        <Badge tone={provider.scope === 'system' ? 'violet' : 'electric'}>{provider.scope}</Badge>
        {provider.capabilities.map((c) => (
          <Badge key={c}>{c}</Badge>
        ))}
      </div>
      {connection && (
        <p className="text-xs text-ink-dim">Last checked {dateTime(connection.last_checked_at)}</p>
      )}
      {connection?.last_error && (
        <Alert tone="warning" className="mt-2">
          {connection.last_error}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" className="mt-2">
          {errorMessage(error)}
        </Alert>
      )}
      {provider.docs_url && (
        <a
          href={provider.docs_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-cyan hover:underline"
        >
          Provider documentation <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
      {canManage && (
        <div className="mt-4 border-t border-line pt-3">
          {isGoogleAccount ? (
            <GoogleConnect connection={connection} />
          ) : !connection ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onOpen({ kind: 'connect', provider })}
            >
              Connect
            </Button>
          ) : confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Disconnect and delete credentials?</span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => remove.mutate(connection.id)}
                loading={remove.isPending}
              >
                Disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => check.mutate(connection.id)}
                loading={check.isPending}
              >
                Test connection
              </Button>
              <Button size="sm" onClick={() => onOpen({ kind: 'edit', provider, connection })}>
                Edit / rotate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  update.mutate({ id: connection.id, enabled: connection.status === 'disabled' })
                }
                loading={update.isPending}
              >
                {connection.status === 'disabled' ? 'Enable' : 'Disable'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                Disconnect
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export function IntegrationsPage() {
  const providers = useProviders();
  const connections = useConnections();
  const workspace = useCurrentWorkspace();
  const { data: auth } = useAuthState();
  const [params] = useSearchParams();
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const isAdmin = auth?.user.is_admin ?? false;
  const workspaceAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';
  const googleResult = params.get('google');
  const connectionFor = (p: Provider) =>
    connections.data?.find(
      (c) =>
        c.provider === p.key &&
        (p.scope === 'system' ? c.workspace_id === null : c.workspace_id === workspace?.id),
    );
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="System"
        title="Integrations"
        subtitle="Connect external services. Credentials are encrypted at rest and never shown again."
      />
      {googleResult === 'connected' && <Alert tone="success">Google account connected.</Alert>}
      {googleResult === 'denied' && <Alert tone="warning">Google access was not granted.</Alert>}
      {googleResult === 'failed' && (
        <Alert tone="danger">
          Connecting Google failed. Check the OAuth app settings and try again.
        </Alert>
      )}
      {providers.isPending || connections.isPending ? (
        <LoadingState />
      ) : providers.isError ? (
        <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
      ) : providers.data.length === 0 ? (
        <EmptyState title="No integrations available" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {providers.data.map((p) => (
            <ProviderCard
              key={p.key}
              provider={p}
              connection={connectionFor(p)}
              canManage={p.scope === 'system' ? isAdmin : workspaceAdmin}
              onOpen={setDialog}
            />
          ))}
        </div>
      )}
      {dialog && <ConnectionDialog mode={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
