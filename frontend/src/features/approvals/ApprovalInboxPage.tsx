import RuleOutlined from '@mui/icons-material/RuleOutlined';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';

import { useApprovals } from '@/api/approvals';
import type { Approval } from '@/api/types';
import { relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';

import { ApprovalDetail } from './ApprovalDetail';

function ApprovalCard({ approval, selected }: { approval: Approval; selected: boolean }) {
  const pending = approval.status === 'pending';
  return (
    <Card
      sx={{
        borderColor: selected ? 'primary.main' : undefined,
        borderWidth: selected ? 2 : undefined,
      }}
    >
      <CardActionArea
        component={RouterLink}
        to={`/approvals/${approval.id}`}
        aria-current={selected ? 'page' : undefined}
      >
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
              {approval.title}
            </Typography>
            <StatusChip status={approval.status} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {approval.action_type}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusChip status={approval.risk_level} prefix="Risk" />
            <Typography variant="caption" color="text.secondary">
              {pending
                ? `Expires ${relativeTime(approval.expires_at)}`
                : `Requested ${relativeTime(approval.created_at)}`}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export function ApprovalInboxPage() {
  const { approvalId } = useParams();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const approvals = useApprovals(tab === 'pending' ? 'pending' : undefined);

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Approval Inbox"
        subtitle="Sensitive actions wait here for your decision. Approvals cover exactly the parameters shown."
      />
      <Tabs
        value={tab}
        onChange={(_, value: 'pending' | 'all') => setTab(value)}
        aria-label="Filter"
      >
        <Tab value="pending" label="Pending" />
        <Tab value="all" label="All" />
      </Tabs>
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: approvalId ? 5 : 12 }}>
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
            <Stack spacing={1.5} component="section" aria-label="Approvals">
              {approvals.data.map((a) => (
                <ApprovalCard key={a.id} approval={a} selected={a.id === approvalId} />
              ))}
            </Stack>
          )}
        </Grid>
        {approvalId && (
          <Grid size={{ xs: 12, md: 7 }}>
            <ApprovalDetail id={approvalId} />
          </Grid>
        )}
        {!approvalId && approvals.data && approvals.data.length > 0 && (
          <Grid size={12}>
            <Box sx={{ color: 'text.secondary', display: 'flex', gap: 1, alignItems: 'center' }}>
              <RuleOutlined fontSize="small" aria-hidden />
              <Typography variant="body2">Select an approval to review it.</Typography>
            </Box>
          </Grid>
        )}
      </Grid>
    </Stack>
  );
}
