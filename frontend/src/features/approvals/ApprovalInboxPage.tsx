import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useApprovals } from '@/api/approvals';
import type { Approval } from '@/api/types';
import { relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';

import { ApprovalDetail } from './ApprovalDetail';

function ApprovalCard({ approval, selected }: { approval: Approval; selected: boolean }) {
  const pending = approval.status === 'pending';
  return (
    <Link
      to={`/approvals/${approval.id}`}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'glass block rounded-lg p-4 transition-[border-color,box-shadow] hover:border-electric/50',
        selected && 'border-cyan shadow-glow-cyan',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold">{approval.title}</h2>
        <StatusChip status={approval.status} />
      </div>
      <p className="mt-0.5 font-mono text-xs text-ink-dim">{approval.action_type}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusChip status={approval.risk_level} prefix="risk" />
        <span className="text-xs text-ink-dim">
          {pending ? `Expires ${relativeTime(approval.expires_at)}` : `Requested ${relativeTime(approval.created_at)}`}
        </span>
      </div>
    </Link>
  );
}

export function ApprovalInboxPage() {
  const { approvalId } = useParams();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const approvals = useApprovals(tab === 'pending' ? 'pending' : undefined);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Command"
        title="Approval Inbox"
        subtitle="Sensitive actions wait here. An approval covers exactly the parameters shown."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'all')}>
        <TabsList aria-label="Filter">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className={cn('grid gap-4', approvalId && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
        <div>
          {approvals.isPending ? (
            <LoadingState />
          ) : approvals.isError ? (
            <ErrorState error={approvals.error} onRetry={() => void approvals.refetch()} />
          ) : approvals.data.length === 0 ? (
            <EmptyState
              title={tab === 'pending' ? 'Nothing waiting for you' : 'No approvals yet'}
              description="Automations that need a human decision will appear here."
            />
          ) : (
            <section aria-label="Approvals" className="space-y-3">
              {approvals.data.map((a) => (
                <ApprovalCard key={a.id} approval={a} selected={a.id === approvalId} />
              ))}
            </section>
          )}
        </div>
        {approvalId && <ApprovalDetail id={approvalId} />}
      </div>
    </div>
  );
}
