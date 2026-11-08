import type { RouteObject } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { isAvailable, NAV_ITEMS } from '@/components/layout/navigation';
import { LoginPage } from '@/features/auth/LoginPage';
import { MfaEnrollPage } from '@/features/auth/MfaEnrollPage';
import { MfaVerifyPage } from '@/features/auth/MfaVerifyPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { OverviewPage } from '@/features/dashboard/OverviewPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { ComingSoonPage } from '@/features/placeholder/ComingSoonPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

const plannedAreas: RouteObject[] = NAV_ITEMS.filter((item) => !isAvailable(item)).map((item) => ({
  path: item.path,
  element: <ComingSoonPage item={item} />,
}));

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/login/mfa', element: <MfaVerifyPage /> },
  { path: '/setup/mfa', element: <MfaEnrollPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: '/settings', element: <SettingsPage /> },
          ...plannedAreas,
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
