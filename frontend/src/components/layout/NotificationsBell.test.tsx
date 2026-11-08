import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Notification } from '@/api/types';
import { authenticatedApi, json, renderRoute } from '@/test/utils';

const notification: Notification = {
  id: 'n1',
  created_at: '2026-11-08T10:00:00Z',
  severity: 'warning',
  category: 'approval',
  title: 'Approval needed: Issue invoice',
  body: '',
  link: '/approvals/ap1',
  workspace_id: 'b2',
  read_at: null,
};

describe('NotificationsBell', () => {
  it('shows the unread count and opens the linked page', async () => {
    const { calls } = authenticatedApi({
      'GET /api/v1/notifications/unread-count': { unread: 3 },
      'GET /api/v1/notifications': [notification],
      'POST /api/v1/notifications/n1/read': json({
        ...notification,
        read_at: '2026-11-08T10:01:00Z',
      }),
      'GET /api/v1/approvals': [],
    });
    const { router } = renderRoute('/');
    const u = userEvent.setup();
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    await u.click(bell);
    await u.click(await screen.findByText('Approval needed: Issue invoice'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/approvals/ap1'));
    expect(calls.some((c) => c.url.endsWith('/notifications/n1/read'))).toBe(true);
  });
});
