import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type SubmitEvent } from 'react';

import { useApproval, useDecideApproval } from '@/api/approvals';
import { errorMessage } from '@/api/client';
import { dateTime, relativeTime } from '@/components/data/format';
import { KeyValueView } from '@/components/data/KeyValueView';
import { StatusChip } from '@/components/data/StatusChip';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { CodeField } from '@/features/auth/CodeField';
import { useNow } from '@/hooks/useNow';

export function ApprovalDetail({ id }: { id: string }) {
  const approval = useApproval(id);
  const decide = useDecideApproval();
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const now = useNow();

  if (approval.isPending) return <LoadingState />;
  if (approval.isError) {
    return <ErrorState error={approval.error} onRetry={() => void approval.refetch()} />;
  }
  const a = approval.data;
  const pending = a.status === 'pending';
  const expired = pending && new Date(a.expires_at).getTime() <= now;
  const needsCode = a.requires_step_up;

  const send = (decision: 'approve' | 'reject') => {
    decide.mutate(
      {
        id: a.id,
        decision,
        note,
        ...(needsCode && decision === 'approve' ? { mfaCode: code } : {}),
      },
      { onSettled: () => setCode('') },
    );
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    send('approve');
  };
  const deciding = decide.isPending ? decide.variables.decision : null;

  return (
    <Card component="section" aria-labelledby="approval-title">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography id="approval-title" variant="h5" component="h2" sx={{ flexGrow: 1 }}>
              {a.title}
            </Typography>
            <StatusChip status={a.status} />
            <StatusChip status={a.risk_level} prefix="Risk" />
          </Stack>
          {a.summary && <Typography>{a.summary}</Typography>}
          <Typography variant="body2" color="text.secondary">
            Action <code>{a.action_type}</code> · requested {dateTime(a.created_at)} ·{' '}
            {pending
              ? `expires ${relativeTime(a.expires_at)}`
              : `decided ${dateTime(a.decided_at)}`}
          </Typography>

          <Divider />
          <Typography variant="subtitle2" component="h3">
            Exact parameters to be executed
          </Typography>
          <KeyValueView data={a.payload} label="Approval parameters" />
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            Payload hash {a.payload_hash.slice(0, 16)}… · version {a.version_ref ?? '—'}
          </Typography>

          {a.decision_note && <Alert severity="info">Note: {a.decision_note}</Alert>}
          {a.consumed_at && (
            <Alert severity="success">Used by the execution on {dateTime(a.consumed_at)}.</Alert>
          )}

          {pending && !expired && (
            <Box component="form" onSubmit={submit} aria-label="Decision">
              <Stack spacing={2}>
                <Divider />
                {decide.isError && <Alert severity="error">{errorMessage(decide.error)}</Alert>}
                {a.requires_step_up && (
                  <Alert severity="warning" icon={<ShieldOutlined />}>
                    High-risk action: approving requires a current two-factor code.
                  </Alert>
                )}
                <TextField
                  label="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
                {needsCode && <CodeField value={code} onChange={setCode} />}
                <Stack direction="row" spacing={1.5}>
                  <Button
                    type="submit"
                    variant="contained"
                    color="success"
                    disabled={needsCode && code.length !== 6}
                    loading={deciding === 'approve'}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    color="error"
                    onClick={() => send('reject')}
                    loading={deciding === 'reject'}
                  >
                    Reject
                  </Button>
                </Stack>
              </Stack>
            </Box>
          )}
          {expired && <Alert severity="warning">This approval has expired.</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}
