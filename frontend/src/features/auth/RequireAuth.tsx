import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuthState } from '@/api/auth';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';

import { routeForAuthState, ROUTES } from './authRouting';

/** Route guard: only fully authenticated users (password + MFA) pass. */
export function RequireAuth() {
  const auth = useAuthState();
  const location = useLocation();

  if (auth.isPending) return <LoadingState label="Loading Personal OS…" />;
  if (auth.isError) {
    return (
      <ErrorState
        error={auth.error}
        title="Cannot reach Personal OS"
        onRetry={() => void auth.refetch()}
      />
    );
  }
  const target = routeForAuthState(auth.data);
  if (target !== ROUTES.home) {
    return <Navigate to={target} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
