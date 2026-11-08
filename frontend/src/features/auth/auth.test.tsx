import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { AuthState } from '@/api/types';
import { apiError, authenticatedApi, fullAuth, mockApi, renderRoute, user } from '@/test/utils';

import { routeForAuthState } from './authRouting';

const pendingEnroll: AuthState = {
  user: { ...user, mfa_enabled: false },
  auth_level: 'password',
  next_step: 'mfa_enroll',
};
const pendingVerify: AuthState = { user, auth_level: 'password', next_step: 'mfa_verify' };

describe('routeForAuthState', () => {
  it.each([
    [null, '/login'],
    [pendingVerify, '/login/mfa'],
    [pendingEnroll, '/setup/mfa'],
    [fullAuth, '/'],
  ])('routes %o to %s', (state, expected) => {
    expect(routeForAuthState(state)).toBe(expected);
  });
});

describe('authentication flow', () => {
  it('redirects signed-out users to the login page', async () => {
    mockApi({
      'GET /api/v1/auth/me': apiError(401, 'unauthenticated'),
      'GET /api/v1/system/health': { status: 'ok', database: 'ok' },
    });
    const { router } = renderRoute('/settings');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('logs in and continues to MFA verification', async () => {
    const { calls } = mockApi({
      'GET /api/v1/auth/me': apiError(401, 'unauthenticated'),
      'POST /api/v1/auth/login': pendingVerify,
    });
    const { router } = renderRoute('/login');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText(/email/i), 'owner@example.test');
    await u.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-factor verification' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login/mfa');
    const loginCall = calls.find((c) => c.url.endsWith('/api/v1/auth/login'));
    await expect(loginCall?.json()).resolves.toEqual({
      email: 'owner@example.test',
      password: 'correct horse battery staple',
    });
  });

  it('shows the server error for invalid credentials', async () => {
    mockApi({
      'GET /api/v1/auth/me': apiError(401, 'unauthenticated'),
      'POST /api/v1/auth/login': apiError(401, 'invalid_credentials', 'Invalid email or password.'),
    });
    renderRoute('/login');
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText(/email/i), 'owner@example.test');
    await u.type(screen.getByLabelText(/password/i), 'nope');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('forces MFA enrollment for password-only sessions', async () => {
    mockApi({ 'GET /api/v1/auth/me': pendingEnroll });
    const { router } = renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: 'Set up two-factor authentication' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup/mfa');
  });

  it('enrolls TOTP and lands on the dashboard', async () => {
    let state: AuthState = pendingEnroll;
    mockApi({
      'GET /api/v1/auth/me': () => new Response(JSON.stringify(state), { status: 200 }),
      'POST /api/v1/auth/mfa/totp/setup': {
        secret: 'JBSWY3DPEHPK3PXP',
        provisioning_uri: 'otpauth://totp/Personal%20OS:owner?secret=JBSWY3DPEHPK3PXP',
      },
      'POST /api/v1/auth/mfa/totp/confirm': () => {
        state = fullAuth;
        return new Response(JSON.stringify(fullAuth), { status: 200 });
      },
      'GET /api/v1/system/health': { status: 'ok', database: 'ok' },
    });
    const { router } = renderRoute('/setup/mfa');
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'Set up authenticator app' }));
    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    const submit = screen.getByRole('button', { name: 'Enable two-factor authentication' });
    expect(submit).toBeDisabled();
    await u.type(screen.getByLabelText(/6-digit code/i), '12a3456');
    expect(screen.getByLabelText(/6-digit code/i)).toHaveValue('123456');
    await u.click(submit);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('lets fully authenticated users through the guard', async () => {
    authenticatedApi();
    renderRoute('/');
    expect(await screen.findByRole('heading', { level: 1, name: /Florin/ })).toBeInTheDocument();
  });
});
