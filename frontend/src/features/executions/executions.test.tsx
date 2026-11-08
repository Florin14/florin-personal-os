import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Automation, ExecutionDetail, Job } from '@/api/types';
import { authenticatedApi, fullAuth, json, renderRoute } from '@/test/utils';

const automation: Automation = {
  id: 'au1',
  workspace_id: 'a1',
  name: 'Monthly invoice',
  description: '',
  enabled: true,
  version: 2,
  definition: { steps: [] },
  triggers: [],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

const detail: ExecutionDetail = {
  id: 'ex1',
  automation_id: 'au1',
  version: 2,
  status: 'waiting_approval',
  dry_run: false,
  trigger_key: 'manual',
  trigger_type: 'manual',
  current_step_key: 'issue',
  cancel_requested: false,
  error: null,
  created_at: '2026-11-08T10:00:00Z',
  started_at: '2026-11-08T10:00:01Z',
  finished_at: null,
  trigger_payload: { month: '2026-10' },
  steps: [
    {
      step_key: 'prepare',
      step_type: 'action',
      status: 'succeeded',
      attempts: 1,
      input: { action: 'core.set_values' },
      output: { values: { amount: '1500.00' } },
      error: null,
      approval_id: null,
      resume_at: null,
      started_at: '2026-11-08T10:00:01Z',
      finished_at: '2026-11-08T10:00:01Z',
    },
    {
      step_key: 'issue',
      step_type: 'action',
      status: 'waiting',
      attempts: 1,
      input: {},
      output: {},
      error: null,
      approval_id: 'ap1',
      resume_at: null,
      started_at: '2026-11-08T10:00:01Z',
      finished_at: null,
    },
  ],
};

describe('Executions & Logs', () => {
  it('lists executions with automation names and statuses', async () => {
    authenticatedApi({
      'GET /api/v1/workspaces/a1/automations': [automation],
      'GET /api/v1/workspaces/a1/executions': [detail],
    });
    renderRoute('/executions');
    const table = await screen.findByRole('table', { name: 'Executions' });
    expect(await within(table).findByText(/Monthly invoice · v2/)).toBeInTheDocument();
    expect(within(table).getByText('Waiting approval')).toBeInTheDocument();
  });

  it('shows the step timeline and cancels a waiting execution', async () => {
    const { calls } = authenticatedApi({
      'GET /api/v1/workspaces/a1/executions/ex1': detail,
      'POST /api/v1/workspaces/a1/executions/ex1/cancel': json({
        ...detail,
        cancel_requested: true,
      }),
    });
    renderRoute('/executions/ex1');
    const u = userEvent.setup();
    expect(await screen.findByText('prepare')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /^issue/ }));
    expect(await screen.findByRole('link', { name: 'View approval' })).toHaveAttribute(
      'href',
      '/approvals/ap1',
    );
    await u.click(screen.getByRole('button', { name: 'Cancel execution' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/ex1/cancel'))).toBe(true));
  });

  it('lets administrators retry failed jobs', async () => {
    const job: Job = {
      id: 'j1',
      kind: 'notifications.deliver',
      status: 'failed',
      priority: 100,
      attempts: 8,
      max_attempts: 8,
      run_at: '2026-11-08T10:00:00Z',
      created_at: '2026-11-08T10:00:00Z',
      updated_at: '2026-11-08T10:05:00Z',
      started_at: null,
      finished_at: null,
      locked_by: null,
      workspace_id: null,
      last_error: 'ConnectionError: discord down',
      failure_class: 'transient',
      payload: {},
    };
    const { calls } = authenticatedApi({
      'GET /api/v1/auth/me': { ...fullAuth, user: { ...fullAuth.user, is_admin: true } },
      'GET /api/v1/workspaces/a1/executions': [],
      'GET /api/v1/jobs': [job],
      'GET /api/v1/jobs/stats': { queued: 0, running: 0, succeeded: 4, failed: 1, cancelled: 0 },
      'POST /api/v1/jobs/j1/retry': json({ ...job, status: 'queued' }),
    });
    renderRoute('/executions');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('tab', { name: 'System jobs' }));
    expect(await screen.findByText('ConnectionError: discord down')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Retry job notifications.deliver' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/jobs/j1/retry'))).toBe(true));
  });
});
