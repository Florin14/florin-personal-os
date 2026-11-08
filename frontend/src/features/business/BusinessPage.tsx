import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Grid,
  Link,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { useSaveAutomation } from '@/api/automation';
import { errorMessage } from '@/api/client';
import { useConnections } from '@/api/integrations';
import {
  fetchWorkflowTemplate,
  useInvoicePreview,
  useInvoiceProfiles,
  useInvoices,
  type InvoiceProfile,
} from '@/api/invoicing';
import { dateTime } from '@/components/data/format';
import { KeyValueView } from '@/components/data/KeyValueView';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

import { ProfileDialog } from './ProfileDialog';

const SPV: Record<number, string> = { [-1]: 'Not sent', 0: 'Processing', 1: 'Sent', 2: 'Errors' };

function InvoicesTable({ workspaceId }: { workspaceId: string }) {
  const invoices = useInvoices(workspaceId);
  if (invoices.isPending) return <LoadingState />;
  if (invoices.isError)
    return <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />;
  if (invoices.data.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        description="Issued invoices appear here with their SPV status."
      />
    );
  }
  return (
    <Card>
      <TableContainer>
        <Table size="small" aria-label="Invoices">
          <TableHead>
            <TableRow>
              <TableCell>Document</TableCell>
              <TableCell>Client</TableCell>
              <TableCell>Period</TableCell>
              <TableCell align="right">Net amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>SPV</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoices.data.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>
                  {inv.link ? (
                    <Link href={inv.link} target="_blank" rel="noopener noreferrer">
                      {inv.series_name} {inv.number}
                    </Link>
                  ) : (
                    `${inv.series_name} ${inv.number ?? '—'}`
                  )}
                  <Typography variant="caption" component="div" color="text.secondary">
                    {inv.issue_date}
                  </Typography>
                </TableCell>
                <TableCell>{inv.client_name}</TableCell>
                <TableCell>{inv.period_start.slice(0, 7)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {inv.net_amount} {inv.currency}
                </TableCell>
                <TableCell>
                  <StatusChip
                    status={
                      inv.status === 'issued'
                        ? 'succeeded'
                        : inv.status === 'failed'
                          ? 'failed'
                          : 'pending'
                    }
                    prefix={inv.status}
                  />
                  {inv.status === 'pending' && (
                    <Typography variant="caption" component="div" color="warning.main">
                      Outcome unknown — verify in Oblio
                    </Typography>
                  )}
                  {inv.error && (
                    <Typography variant="caption" component="div" color="error">
                      {inv.error}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {inv.einvoice_code === null
                    ? '—'
                    : (SPV[inv.einvoice_code] ?? String(inv.einvoice_code))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

function ProfileCard({
  workspaceId,
  profile,
  canEdit,
  onEdit,
}: {
  workspaceId: string;
  profile: InvoiceProfile;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const preview = useInvoicePreview(workspaceId, profile.id);
  const save = useSaveAutomation(workspaceId);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const createAutomation = async () => {
    setError(null);
    try {
      const definition = await fetchWorkflowTemplate(workspaceId, profile.id);
      const automation = await save.mutateAsync({
        input: {
          name: `Monthly invoice – ${profile.name}`,
          description: `Prepare, approve (with MFA), issue in Oblio and send to SPV for ${profile.client_name}.`,
          definition,
        },
      });
      void navigate(`/workflows/${automation.id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <ReceiptLongOutlined color="primary" aria-hidden />
          <Typography variant="h6" component="h3" sx={{ flexGrow: 1 }}>
            {profile.name}
          </Typography>
          {!profile.enabled && <StatusChip status="cancelled" prefix="Off" />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {profile.client_name} · series {profile.series_name} · {profile.unit_price}{' '}
          {profile.currency} × {profile.quantity}
        </Typography>
        <Typography variant="subtitle2">Next draft</Typography>
        {preview.isPending ? (
          <LoadingState compact />
        ) : preview.isError ? (
          <ErrorState compact error={preview.error} />
        ) : (
          <KeyValueView
            label="Invoice draft preview"
            data={{
              period: preview.data.period,
              description: preview.data.description,
              'net amount': `${String(preview.data.net_amount)} ${String(preview.data.currency)}`,
              'issue / due': `${String(preview.data.issue_date)} / ${String(preview.data.due_date)}`,
            }}
          />
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          Updated {dateTime(profile.updated_at)}
        </Typography>
      </CardContent>
      {canEdit && (
        <CardActions>
          <Button onClick={onEdit}>Edit</Button>
          <Button
            variant="contained"
            onClick={() => void createAutomation()}
            loading={save.isPending}
          >
            Create monthly automation
          </Button>
        </CardActions>
      )}
    </Card>
  );
}

export function BusinessPage() {
  const workspace = useCurrentWorkspace();
  const profiles = useInvoiceProfiles(workspace?.id);
  const connections = useConnections();
  const [tab, setTab] = useState<'invoices' | 'profiles'>('invoices');
  const [editing, setEditing] = useState<InvoiceProfile | 'new' | null>(null);
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin';
  const oblio = connections.data?.find(
    (c) => c.provider === 'oblio' && c.workspace_id === workspace?.id,
  );

  if (!workspace) return <EmptyState title="No workspace selected" />;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Business & Accounting"
        subtitle="Recurring invoices through Oblio, always approved by you before issuance."
        actions={
          canEdit && (
            <Button variant="contained" onClick={() => setEditing('new')}>
              New invoice profile
            </Button>
          )
        }
      />
      {workspace.kind !== 'business' && (
        <Alert severity="info">
          You are in a personal workspace. Switch to your business workspace to invoice.
        </Alert>
      )}
      {!connections.isPending && !oblio && (
        <Alert
          severity="warning"
          action={
            <Button component={RouterLink} to="/integrations">
              Connect
            </Button>
          }
        >
          Oblio is not connected for this workspace. Use “mock” mode to try the workflow without
          credentials.
        </Alert>
      )}
      {oblio?.status === 'error' && (
        <Alert severity="error">
          Oblio credentials were rejected: {oblio.last_error}. Invoicing workflows will stop safely
          until you reconnect.
        </Alert>
      )}
      <Tabs value={tab} onChange={(_, v: 'invoices' | 'profiles') => setTab(v)}>
        <Tab value="invoices" label="Invoices" />
        <Tab value="profiles" label="Invoice profiles" />
      </Tabs>
      {tab === 'invoices' ? (
        <InvoicesTable workspaceId={workspace.id} />
      ) : profiles.isPending ? (
        <LoadingState />
      ) : profiles.isError ? (
        <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} />
      ) : profiles.data.length === 0 ? (
        <EmptyState
          title="No invoice profiles"
          description="A profile holds the client, series, VAT, amount and due-date settings for a recurring invoice."
        />
      ) : (
        <Grid container spacing={2.5}>
          {profiles.data.map((p) => (
            <Grid key={p.id} size={{ xs: 12, md: 6 }}>
              <ProfileCard
                workspaceId={workspace.id}
                profile={p}
                canEdit={canEdit}
                onEdit={() => setEditing(p)}
              />
            </Grid>
          ))}
        </Grid>
      )}
      {editing && (
        <ProfileDialog
          workspaceId={workspace.id}
          {...(editing === 'new' ? {} : { profile: editing })}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
