import { describe, expect, it, vi } from 'vitest';

import { apiError, json, mockApi } from '@/test/utils';

import { api, ApiError, readCookie, unwrap } from './client';

describe('readCookie', () => {
  it('returns the value of a named cookie', () => {
    document.cookie = 'other=1; path=/';
    document.cookie = 'pos_csrf=abc%20def; path=/';
    expect(readCookie('pos_csrf')).toBe('abc def');
    expect(readCookie('missing')).toBeNull();
  });
});

describe('CSRF header', () => {
  it('is sent on unsafe requests and omitted on safe ones', async () => {
    document.cookie = 'pos_csrf=token-123; path=/';
    const { calls } = mockApi({
      'POST /api/v1/auth/logout': new Response(null, { status: 204 }),
      'GET /api/v1/auth/me': json({}),
    });
    await api.POST('/api/v1/auth/logout');
    await api.GET('/api/v1/auth/me');
    expect(calls[0]?.headers.get('X-CSRF-Token')).toBe('token-123');
    expect(calls[1]?.headers.get('X-CSRF-Token')).toBeNull();
  });
});

describe('unwrap', () => {
  it('maps the error envelope to ApiError', async () => {
    mockApi({ 'GET /api/v1/workspaces': apiError(403, 'mfa_required', 'MFA required.') });
    const error = await unwrap(api.GET('/api/v1/workspaces')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'mfa_required', message: 'MFA required.' });
  });

  it('reports network failures with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await unwrap(api.GET('/api/v1/workspaces')).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('returns data on success', async () => {
    mockApi({ 'GET /api/v1/system/health': { status: 'ok', database: 'ok' } });
    await expect(unwrap(api.GET('/api/v1/system/health'))).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });
});
