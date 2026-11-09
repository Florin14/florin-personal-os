import { ArrowLeft, ChevronDown, Plus, Workflow } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { useAutomation, useAutomations } from '@/api/automation';
import type { Automation } from '@/api/types';
import { relativeTime } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlay';
import { Badge, Panel, StatusDot } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { cn } from '@/lib/cn';

import { describeTrigger, toModel } from './builderModel';
import { WorkflowEditor } from './WorkflowEditor';

function AutomationCard({ automation }: { automation: Automation }) {
  const model = toModel(automation.definition);
  return (
    <Link
      to={`/workflows/${automation.id}`}
      className="glass group flex flex-col gap-3 rounded-lg p-4 transition-[border-color,box-shadow] hover:border-electric/50 hover:shadow-glow"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-electric/40 bg-electric/10 text-electric-soft">
          <Workflow className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold text-ink">{automation.name}</p>
          <p className="truncate text-xs text-ink-dim">
            {automation.description || 'No description'}
          </p>
        </div>
        <StatusDot
          tone={automation.enabled ? 'success' : 'neutral'}
          label={automation.enabled ? 'Enabled' : 'Disabled'}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {model.triggers.slice(0, 3).map((t, i) => (
          <Badge key={`${t.type}:${String(i)}`} tone="info">
            {t.type === 'manual' ? 'manual' : describeTrigger(t)}
          </Badge>
        ))}
      </div>
      <p className="mt-auto flex items-center gap-2 font-mono text-[11px] text-ink-dim">
        <span>v{String(automation.version)}</span>·
        <span>
          {String(model.steps.length)} step{model.steps.length === 1 ? '' : 's'}
        </span>
        ·<span>updated {relativeTime(automation.updated_at)}</span>
      </p>
    </Link>
  );
}

function AutomationSwitcher({
  automations,
  currentId,
  canEdit,
}: {
  automations: Automation[];
  currentId: string | undefined;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const current = automations.find((a) => a.id === currentId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="max-w-72">
          <span className="truncate">{current?.name ?? 'New automation'}</span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {automations.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onSelect={() => void navigate(`/workflows/${a.id}`)}
            className={cn(a.id === currentId && 'text-ink')}
          >
            <StatusDot tone={a.enabled ? 'success' : 'neutral'} />
            <span className="flex-1 truncate">{a.name}</span>
            <span className="font-mono text-[10px] text-ink-dim">v{String(a.version)}</span>
          </DropdownMenuItem>
        ))}
        {canEdit && (
          <>
            {automations.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => void navigate('/workflows/new')}>
              <Plus /> New automation
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function WorkflowBuilderPage() {
  const { automationId } = useParams();
  const workspace = useCurrentWorkspace();
  const automations = useAutomations(workspace?.id);
  const isNew = automationId === 'new';
  const selected = useAutomation(workspace?.id, isNew ? undefined : automationId);
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin';

  const newButton = canEdit && (
    <Button asChild variant="primary">
      <Link to="/workflows/new">
        <Plus /> New automation
      </Link>
    </Button>
  );

  if (!workspace) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workflow Builder" />
        <EmptyState title="No workspace selected" />
      </div>
    );
  }

  if (!automationId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Automation"
          title="Workflow Builder"
          subtitle={`Design automations for ${workspace.name}. Workflows are typed and versioned — every save creates a new version.`}
          actions={newButton}
        />
        {automations.isPending ? (
          <LoadingState />
        ) : automations.isError ? (
          <ErrorState error={automations.error} onRetry={() => void automations.refetch()} />
        ) : automations.data.length === 0 ? (
          <Panel>
            <EmptyState
              title="No automations yet"
              description="Start from a template or build a workflow from triggers, conditions, approvals and actions."
              action={newButton}
            />
          </Panel>
        ) : (
          <ul aria-label="Automations" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {automations.data.map((a) => (
              <li key={a.id} className="flex">
                <AutomationCard automation={a} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  let editor;
  if (isNew) {
    editor = canEdit ? (
      <WorkflowEditor key="new" workspaceId={workspace.id} canEdit />
    ) : (
      <EmptyState title="Only owners and admins can create automations" />
    );
  } else if (selected.isPending) {
    editor = <LoadingState />;
  } else if (selected.isError) {
    editor = <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />;
  } else {
    editor = (
      <WorkflowEditor
        key={`${selected.data.id}:${String(selected.data.version)}`}
        workspaceId={workspace.id}
        automation={selected.data}
        canEdit={canEdit}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/workflows">
            <ArrowLeft /> All automations
          </Link>
        </Button>
        <h1 className="font-display text-xl font-semibold tracking-tight">
          {isNew ? 'New automation' : (selected.data?.name ?? 'Workflow Builder')}
        </h1>
        <span className="flex-1" />
        <AutomationSwitcher
          automations={automations.data ?? []}
          currentId={automationId}
          canEdit={canEdit}
        />
      </div>
      {editor}
    </div>
  );
}
