import { ExternalLink, FileText, Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

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
import { formatMoney } from '@/components/data/format';
import { KeyValueView } from '@/components/data/KeyValueView';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Metric, Panel, Table, Td, Th, Tr } from '@/components/ui/surface';
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
    <Table aria-label="Invoices">
      <thead>
        <tr>
          <Th>Document</Th>
          <Th>Client</Th>
          <Th>Period</Th>
          <Th className="text-right">Net amount</Th>
          <Th>Status</Th>
          <Th>SPV</Th>
        </tr>
      </thead>
      <tbody>
        {invoices.data.map((inv) => (
          <Tr key={inv.id}>
            <Td>
              {inv.link ? (
                <a
                  href={inv.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-cyan hover:underline"
                >
                  {inv.series_name} {inv.number} <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                `${inv.series_name} ${inv.number ?? '—'}`
              )}
              <span className="block font-mono text-[11px] text-ink-dim">{inv.issue_date}</span>
            </Td>
            <Td>{inv.client_name}</Td>
            <Td className="font-mono text-ink-muted">{inv.period_start.slice(0, 7)}</Td>
            <Td className="text-right font-mono tabular-nums">
              {formatMoney(inv.net_amount, inv.currency)}
            </Td>
            <Td>
              <StatusChip status={inv.status} />
              {inv.status === 'pending' && (
                <span className="mt-1 block text-[11px] text-warning">
                  Outcome unknown — verify in Oblio
                </span>
              )}
              {inv.error && <span className="mt-1 block text-[11px] text-danger">{inv.error}</span>}
            </Td>
            <Td className="text-ink-muted">
              {inv.einvoice_code === null
                ? '—'
                : (SPV[inv.einvoice_code] ?? String(inv.einvoice_code))}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
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
    <Panel
      title={profile.name}
      icon={<Receipt />}
      action={!profile.enabled ? <Badge>off</Badge> : undefined}
    >
      <p className="mb-3 text-sm text-ink-muted">
        {profile.client_name} · series {profile.series_name} ·{' '}
        {formatMoney(profile.unit_price, profile.currency)} × {profile.quantity}
      </p>
      <p className="label-caps mb-1">Next draft</p>
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
            'net amount': formatMoney(
              String(preview.data.net_amount),
              String(preview.data.currency),
            ),
            'issue / due': `${String(preview.data.issue_date)} / ${String(preview.data.due_date)}`,
          }}
        />
      )}
      {error && (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void createAutomation()}
            loading={save.isPending}
          >
            Create monthly automation
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function BusinessPage() {
  const workspace = useCurrentWorkspace();
  const profiles = useInvoiceProfiles(workspace?.id);
  const invoices = useInvoices(workspace?.id);
  const connections = useConnections();
  const [editing, setEditing] = useState<InvoiceProfile | 'new' | null>(null);
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin';
  const oblio = connections.data?.find(
    (c) => c.provider === 'oblio' && c.workspace_id === workspace?.id,
  );
  if (!workspace) return <EmptyState title="No workspace selected" />;
  const issued = (invoices.data ?? []).filter((i) => i.status === 'issued').length;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={workspace.kind === 'business' ? workspace.name : 'Domains'}
        title="Business & Accounting"
        subtitle="Recurring invoices through Oblio — always approved by you (with MFA) before issuance."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus /> New invoice profile
            </Button>
          )
        }
      />
      {workspace.kind !== 'business' && (
        <Alert>
          You are in a personal workspace. Switch to your business workspace (e.g. FLOZITECH SRL) in
          the sidebar to invoice.
        </Alert>
      )}
      {!connections.isPending && !oblio && (
        <Alert
          tone="warning"
          action={
            <Button asChild size="sm">
              <Link to="/integrations">Connect</Link>
            </Button>
          }
        >
          Oblio is not connected for this workspace. Use “mock” mode to try the workflow without
          credentials.
        </Alert>
      )}
      {oblio?.status === 'error' && (
        <Alert tone="danger">
          Oblio credentials were rejected: {oblio.last_error}. Invoicing workflows stop safely until
          you reconnect.
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Invoices issued" value={issued} />
        <Metric label="Profiles" value={profiles.data?.length ?? '—'} />
        <Metric
          label="Oblio"
          value={oblio?.status ?? 'off'}
          tone={oblio?.status === 'active' ? 'success' : 'neutral'}
        />
        <Metric
          label="Unverified"
          value={(invoices.data ?? []).filter((i) => i.status === 'pending').length}
        />
      </div>
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">
            <FileText className="mr-1.5 inline size-3.5" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="profiles">
            <Receipt className="mr-1.5 inline size-3.5" />
            Invoice profiles
          </TabsTrigger>
        </TabsList>
        <TabsContent value="invoices" className="mt-4">
          <Panel>
            <InvoicesTable workspaceId={workspace.id} />
          </Panel>
        </TabsContent>
        <TabsContent value="profiles" className="mt-4">
          {profiles.isPending ? (
            <LoadingState />
          ) : profiles.isError ? (
            <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} />
          ) : profiles.data.length === 0 ? (
            <EmptyState
              title="No invoice profiles"
              description="A profile holds the client, series, VAT, amount and due-date settings for a recurring invoice."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {profiles.data.map((p) => (
                <ProfileCard
                  key={p.id}
                  workspaceId={workspace.id}
                  profile={p}
                  canEdit={canEdit}
                  onEdit={() => setEditing(p)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      {editing && (
        <ProfileDialog
          workspaceId={workspace.id}
          {...(editing === 'new' ? {} : { profile: editing })}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
