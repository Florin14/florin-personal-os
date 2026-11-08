import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client';
import { mockApi, renderWithProviders } from '@/test/utils';

import { ConnectionBanner } from './ConnectionBanner';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

describe('state views', () => {
  it('announces loading', () => {
    renderWithProviders(<LoadingState label="Loading things" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading things');
  });

  it('shows the error message and retries', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <ErrorState error={new ApiError(500, 'internal_error', 'Boom.')} onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Boom.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders an unauthorized state for 403 errors', () => {
    renderWithProviders(<ErrorState error={new ApiError(403, 'insufficient_role', 'No.')} />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
  });

  it('renders empty state content', () => {
    renderWithProviders(<EmptyState title="Nothing here" description="Add something." />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add something.')).toBeInTheDocument();
  });
});

describe('ConnectionBanner', () => {
  it('shows the offline state', async () => {
    mockApi({ 'GET /api/v1/system/health': { status: 'ok', database: 'ok' } });
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithProviders(<ConnectionBanner />);
    expect(await screen.findByText(/You are offline/)).toBeInTheDocument();

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument();
  });
});
