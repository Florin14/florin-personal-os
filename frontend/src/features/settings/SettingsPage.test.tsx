import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { authenticatedApi, renderRoute, sessions } from '@/test/utils';

import { describeUserAgent } from './userAgent';

describe('describeUserAgent', () => {
  it.each([
    [null, 'Unknown device'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/604.1', 'Safari on iOS'],
    ['curl/8.0', 'Other client'],
  ])('%s -> %s', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });
});

describe('Settings & Security', () => {
  it('lists sessions and revokes another device', async () => {
    let current = sessions;
    const { calls } = authenticatedApi({
      'GET /api/v1/auth/sessions': () => new Response(JSON.stringify(current), { status: 200 }),
      'DELETE /api/v1/auth/sessions/s2': () => {
        current = sessions.filter((s) => s.id !== 's2');
        return new Response(null, { status: 204 });
      },
    });
    renderRoute('/settings');

    const list = await screen.findByRole('list', { name: 'Active sessions' });
    expect(await within(list).findByText('Chrome on Windows')).toBeInTheDocument();
    expect(within(list).getByText('This device')).toBeInTheDocument();

    await userEvent
      .setup()
      .click(within(list).getByRole('button', { name: /Sign out session from Safari on iOS/ }));

    await waitFor(() => expect(within(list).queryByText('Safari on iOS')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/sessions/s2'))).toBe(true);
  });

  it('validates the password change form before submitting', async () => {
    const { calls } = authenticatedApi({
      'POST /api/v1/auth/password': () => new Response(null, { status: 204 }),
    });
    renderRoute('/settings');
    const u = userEvent.setup();
    const submit = await screen.findByRole('button', { name: 'Update password' });

    await u.type(screen.getByLabelText(/^Current password/), 'old password value');
    await u.type(screen.getByLabelText(/^New password/), 'short');
    expect(submit).toBeDisabled();

    await u.clear(screen.getByLabelText(/^New password/));
    await u.type(screen.getByLabelText(/^New password/), 'a much longer passphrase');
    await u.type(screen.getByLabelText(/^Confirm new password/), 'a different passphrase');
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await u.clear(screen.getByLabelText(/^Confirm new password/));
    await u.type(screen.getByLabelText(/^Confirm new password/), 'a much longer passphrase');
    await u.click(submit);

    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    const call = calls.find((c) => c.url.endsWith('/api/v1/auth/password'));
    await expect(call?.json()).resolves.toEqual({
      current_password: 'old password value',
      new_password: 'a much longer passphrase',
    });
  });

  it('switches the theme preference', async () => {
    authenticatedApi();
    renderRoute('/settings');
    const group = await screen.findByRole('group', { name: 'Color theme' });
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Light' }));
    expect(within(group).getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});
