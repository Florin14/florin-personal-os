import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiError, authenticatedApi, renderRoute } from '@/test/utils';

describe('Overview dashboard', () => {
  it('shows system status, security and workspaces', async () => {
    authenticatedApi();
    renderRoute('/');

    const status = await screen.findByRole('region', { name: 'System status' });
    expect(await within(status).findByText('Online')).toBeInTheDocument();
    expect(within(status).getByText('Connected')).toBeInTheDocument();
    expect(within(status).getByText(/0\.1\.0/)).toBeInTheDocument();

    const security = screen.getByRole('region', { name: 'Security' });
    expect(within(security).getByText('Enabled')).toBeInTheDocument();
    expect(await within(security).findByText('2')).toBeInTheDocument();

    const ws = screen.getByRole('region', { name: 'Workspaces' });
    expect(await within(ws).findByText('Florin SRL')).toBeInTheDocument();
    expect(within(ws).getByText('Personal')).toBeInTheDocument();
  });

  it('lists planned areas with their phase', async () => {
    authenticatedApi();
    renderRoute('/');
    const roadmap = await screen.findByRole('region', { name: 'Areas & roadmap' });
    expect(within(roadmap).getByText('Approval Inbox')).toBeInTheDocument();
    expect(within(roadmap).getAllByText('Phase 2').length).toBeGreaterThan(0);
  });

  it('renders an error state with retry when a widget fails', async () => {
    authenticatedApi({
      'GET /api/v1/workspaces': apiError(500, 'internal_error', 'Server exploded.'),
    });
    renderRoute('/');
    const ws = await screen.findByRole('region', { name: 'Workspaces' });
    expect(await within(ws).findByText('Server exploded.')).toBeInTheDocument();
    expect(within(ws).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no workspaces', async () => {
    authenticatedApi({ 'GET /api/v1/workspaces': [] });
    renderRoute('/');
    expect(await screen.findByText('No workspaces yet')).toBeInTheDocument();
  });

  it('shows the disconnected banner when the API is unreachable', async () => {
    authenticatedApi({
      'GET /api/v1/system/health': apiError(503, 'http_503', 'Unavailable'),
    });
    renderRoute('/');
    expect(await screen.findByText(/Cannot reach the Personal OS server/)).toBeInTheDocument();
  });

  it('navigates to a planned area placeholder', async () => {
    authenticatedApi();
    renderRoute('/');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    await userEvent.setup().click(within(nav).getByRole('link', { name: /Approval Inbox/ }));
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.getByText('Planned · Phase 2')).toBeInTheDocument();
  });

  it('shows not found for unknown routes', async () => {
    authenticatedApi();
    renderRoute('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
