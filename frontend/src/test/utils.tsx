import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';

import type { AuthState, SessionInfo, SystemInfo, Workspace } from '@/api/types';
import { AppProviders } from '@/app/providers';
import { routes as appRoutes } from '@/app/routes';

type Handler = (request: Request) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function apiError(status: number, code: string, message = 'Error'): Response {
  return json({ error: { code, message } }, status);
}

/** Stubs global fetch; handlers are keyed by "METHOD /path". Unmatched calls return 404. */
export function mockApi(handlers: Record<string, unknown>) {
  const calls: Request[] = [];
  const fetchMock = vi.fn(async (input: Request) => {
    calls.push(input.clone());
    const key = `${input.method} ${new URL(input.url).pathname}`;
    const handler = handlers[key];
    if (handler === undefined) return apiError(404, 'not_found', `No mock for ${key}`);
    if (typeof handler === 'function') return (handler as Handler)(input);
    if (handler instanceof Response) return handler.clone();
    return json(handler);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function renderRoute(
  path: string,
  options: { routes?: RouteObject[]; queryClient?: QueryClient } = {},
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(options.routes ?? appRoutes, { initialEntries: [path] });
  const result = render(
    <AppProviders queryClient={options.queryClient ?? testQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return Object.assign(result, { router });
}

export function renderWithProviders(ui: ReactElement, queryClient = testQueryClient()) {
  return renderRoute('/', { routes: [{ path: '/', element: ui }], queryClient });
}

// ----------------------------------------------------------------------------- fixtures

export const user = {
  id: '6f1f7a3e-0d55-4e7b-9a43-0d4d1b2f9c11',
  email: 'owner@example.test',
  display_name: 'Florin',
  timezone: 'Europe/Bucharest',
  mfa_enabled: true,
  is_admin: true,
  last_login_at: '2026-11-08T10:00:00Z',
} satisfies AuthState['user'];

export const fullAuth: AuthState = { user, auth_level: 'full', next_step: 'none' };

export const workspaces: Workspace[] = [
  {
    id: 'a1',
    slug: 'personal',
    name: 'Personal',
    kind: 'personal',
    timezone: 'Europe/Bucharest',
    default_currency: 'RON',
    role: 'owner',
  },
  {
    id: 'b2',
    slug: 'florin-srl',
    name: 'Florin SRL',
    kind: 'business',
    timezone: 'Europe/Bucharest',
    default_currency: 'RON',
    role: 'owner',
  },
];

export const systemInfo: SystemInfo = {
  name: 'Personal OS',
  version: '0.1.0',
  environment: 'development',
  server_time: '2026-11-08T10:00:00Z',
  mfa_required: true,
  modules: [
    { name: 'system', title: 'System', description: '' },
    { name: 'identity', title: 'Identity', description: '' },
    { name: 'workspaces', title: 'Workspaces', description: '' },
  ],
};

export const sessions: SessionInfo[] = [
  {
    id: 's1',
    created_at: '2026-11-08T09:00:00Z',
    last_seen_at: '2026-11-08T10:00:00Z',
    expires_at: '2026-11-15T09:00:00Z',
    auth_level: 'full',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',
    ip_address: '10.8.0.2',
    current: true,
  },
  {
    id: 's2',
    created_at: '2026-11-07T09:00:00Z',
    last_seen_at: '2026-11-07T20:00:00Z',
    expires_at: '2026-11-14T09:00:00Z',
    auth_level: 'full',
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/604.1',
    ip_address: '10.8.0.3',
    current: false,
  },
];

/** Handlers for a fully authenticated, healthy backend. */
export function authenticatedApi(overrides: Record<string, unknown> = {}) {
  return mockApi({
    'GET /api/v1/auth/me': fullAuth,
    'GET /api/v1/system/health': { status: 'ok', database: 'ok' },
    'GET /api/v1/system/info': systemInfo,
    'GET /api/v1/workspaces': workspaces,
    'GET /api/v1/auth/sessions': sessions,
    'GET /api/v1/notifications/unread-count': { unread: 0 },
    'GET /api/v1/notifications': [],
    'GET /api/v1/automation/controls': { emergency_stop: false, changed_at: null, reason: null },
    'GET /api/v1/audit': [],
    ...overrides,
  });
}
