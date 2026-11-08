import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined';
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';

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
import { dateTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
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
    const filledSecrets = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== ''));
    const done = { onSuccess: onClose };
    if (editing) {
      update.mutate(
        {
          id: mode.connection.id,
          config,
          secrets: Object.keys(filledSecrets).length ? filledSecrets : null,
        },
        done,
      );
    } else {
      create.mutate(
        {
          provider: mode.provider.key,
          workspace_id: systemScope ? null : (workspace?.id ?? null),
          name: mode.provider.title,
          config,
          secrets: filledSecrets,
        },
        done,
      );
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="connection-title">
      <DialogTitle id="connection-title">
        {editing ? `Edit ${mode.provider.title}` : `Connect ${mode.provider.title}`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {systemScope
              ? 'System-wide integration (administrators only).'
              : `Connected to the workspace “${workspace?.name ?? ''}”.`}{' '}
            Secrets are encrypted and can never be read back.
          </Typography>
          <SchemaFields
            schema={schema}
            values={values}
            onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
          />
          {mode.provider.secret_fields.map((field) => (
            <TextField
              key={field}
              type="password"
              autoComplete="off"
              label={editing ? `${field} (leave empty to keep)` : field}
              value={secrets[field] ?? ''}
              onChange={(e) => setSecrets((s) => ({ ...s, [field]: e.target.value }))}
              required={!editing}
            />
          ))}
          {(localError ?? mutation.error) && (
            <Alert severity="error">{localError ?? errorMessage(mutation.error)}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} loading={mutation.isPending}>
          {editing ? 'Save' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
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
  onOpen: (mode: DialogMode) => void;
}) {
  const check = useCheckConnection();
  const update = useUpdateConnection();
  const remove = useDeleteConnection();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const error = check.error ?? update.error ?? remove.error;

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <ExtensionOutlined color="primary" aria-hidden />
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            {provider.title}
          </Typography>
          {connection ? (
            <StatusChip
              status={
                connection.status === 'active'
                  ? 'succeeded'
                  : connection.status === 'error'
                    ? 'failed'
                    : 'cancelled'
              }
              prefix={connection.status}
            />
          ) : (
            <Chip size="small" label="Not connected" variant="outlined" />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {provider.description}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
          <Chip size="small" label={provider.scope === 'system' ? 'System' : 'Workspace'} />
          {provider.capabilities.map((c) => (
            <Chip key={c} size="small" variant="outlined" label={c} />
          ))}
        </Stack>
        {connection && (
          <Typography variant="body2" color="text.secondary">
            Last checked: {dateTime(connection.last_checked_at)}
          </Typography>
        )}
        {connection?.last_error && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {connection.last_error}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage(error)}
          </Alert>
        )}
        {provider.docs_url && (
          <Link href={provider.docs_url} target="_blank" rel="noopener noreferrer" variant="body2">
            Provider documentation
          </Link>
        )}
      </CardContent>
      {canManage && (
        <CardActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          {!connection ? (
            <Button variant="contained" onClick={() => onOpen({ kind: 'connect', provider })}>
              Connect
            </Button>
          ) : confirmDelete ? (
            <>
              <Typography variant="body2">Disconnect and delete credentials?</Typography>
              <Button
                color="error"
                onClick={() => remove.mutate(connection.id)}
                loading={remove.isPending}
              >
                Disconnect
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
            </>
          ) : (
            <>
              <Button onClick={() => check.mutate(connection.id)} loading={check.isPending}>
                Test connection
              </Button>
              <Button onClick={() => onOpen({ kind: 'edit', provider, connection })}>
                Edit / rotate
              </Button>
              <Button
                onClick={() =>
                  update.mutate({ id: connection.id, enabled: connection.status === 'disabled' })
                }
                loading={update.isPending}
              >
                {connection.status === 'disabled' ? 'Enable' : 'Disable'}
              </Button>
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                Disconnect
              </Button>
            </>
          )}
        </CardActions>
      )}
    </Card>
  );
}

export function IntegrationsPage() {
  const providers = useProviders();
  const connections = useConnections();
  const workspace = useCurrentWorkspace();
  const { data: auth } = useAuthState();
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const isAdmin = auth?.user.is_admin ?? false;
  const workspaceAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

  const connectionFor = (p: Provider) =>
    connections.data?.find(
      (c) =>
        c.provider === p.key &&
        (p.scope === 'system' ? c.workspace_id === null : c.workspace_id === workspace?.id),
    );

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Integrations"
        subtitle="Connect external services. Credentials are encrypted at rest and never shown again."
      />
      {providers.isPending || connections.isPending ? (
        <LoadingState />
      ) : providers.isError ? (
        <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
      ) : providers.data.length === 0 ? (
        <EmptyState title="No integrations available" />
      ) : (
        <Grid container spacing={2.5}>
          {providers.data.map((p) => (
            <Grid key={p.key} size={{ xs: 12, md: 6 }}>
              <ProviderCard
                provider={p}
                connection={connectionFor(p)}
                canManage={p.scope === 'system' ? isAdmin : workspaceAdmin}
                onOpen={setDialog}
              />
            </Grid>
          ))}
        </Grid>
      )}
      {dialog && <ConnectionDialog mode={dialog} onClose={() => setDialog(null)} />}
    </Stack>
  );
}
