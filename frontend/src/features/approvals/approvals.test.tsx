import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Approval } from '@/api/types';
import { apiError, authenticatedApi, json, renderRoute } from '@/test/utils';

const base: Approval = {
  id: 'ap1',
  workspace_id: 'b2',
  action_type: 'invoicing.issue',
  title: 'Issue November invoice',
  summary: 'Monthly invoice for ACME',
  payload: { client: 'ACME SRL', amount: '1500.00', currency: 'RON' },
  payload_hash: 'a'.repeat(64),
  version_ref: 'v-1',
  risk_level: 'medium',
  status: 'pending',
  subject_type: 'execution_step',
  subject_id: 'e1:issue',
  created_at: '2026-11-08T10:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  decided_at: null,
  decided_by_user_id: null,
  decided_via: null,
  decision_note: null,
  consumed_at: null,
  requires_step_up: false,
};

describe('Approval Inbox', () => {
  it('lists pending approvals and shows exact parameters', async () => {
    authenticatedApi({
      'GET /api/v1/approvals': [base],
      'GET /api/v1/approvals/ap1': base,
    });
    renderRoute('/approvals/ap1');
    const list = await screen.findByRole('region', { name: 'Approvals' });
    expect(within(list).getByText('Issue November invoice')).toBeInTheDocument();
    const params = await screen.findByRole('table', { name: 'Approval parameters' });
    expect(within(params).getByText('ACME SRL')).toBeInTheDocument();
    expect(within(params).getByText('1500.00')).toBeInTheDocument();
  });

  it('approves a medium-risk request without a code', async () => {
    const { calls } = authenticatedApi({
      'GET /api/v1/approvals': [base],
      'GET /api/v1/approvals/ap1': base,
      'POST /api/v1/approvals/ap1/decision': json({ ...base, status: 'approved' }),
    });
    renderRoute('/approvals/ap1');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/v1/approvals/ap1/decision'))).toBe(true),
    );
    const call = calls.find((c) => c.url.endsWith('/decision'));
    await expect(call?.json()).resolves.toMatchObject({ decision: 'approve', mfa_code: null });
  });

  it('requires a two-factor code for high-risk approvals', async () => {
    const high = { ...base, risk_level: 'high' as const, requires_step_up: true };
    const { calls } = authenticatedApi({
      'GET /api/v1/approvals': [high],
      'GET /api/v1/approvals/ap1': high,
      'POST /api/v1/approvals/ap1/decision': json({ ...high, status: 'approved' }),
    });
    renderRoute('/approvals/ap1');
    const u = userEvent.setup();
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(screen.getByText(/requires a current two-factor code/)).toBeInTheDocument();
    await u.type(screen.getByLabelText(/6-digit code/i), '123456');
    await u.click(approve);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/decision'))).toBe(true));
    const call = calls.find((c) => c.url.endsWith('/decision'));
    await expect(call?.json()).resolves.toMatchObject({ decision: 'approve', mfa_code: '123456' });
  });

  it('rejects without requiring a code and shows server errors', async () => {
    const high = { ...base, risk_level: 'high' as const, requires_step_up: true };
    authenticatedApi({
      'GET /api/v1/approvals': [high],
      'GET /api/v1/approvals/ap1': high,
      'POST /api/v1/approvals/ap1/decision': apiError(
        409,
        'approval_expired',
        'Approval has expired.',
      ),
    });
    renderRoute('/approvals/ap1');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Approval has expired.')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is pending', async () => {
    authenticatedApi({ 'GET /api/v1/approvals': [] });
    renderRoute('/approvals');
    expect(await screen.findByText('Nothing waiting for you')).toBeInTheDocument();
  });
});
