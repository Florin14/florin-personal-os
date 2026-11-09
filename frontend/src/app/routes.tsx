import type { RouteObject } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { isAvailable, NAV_ITEMS } from '@/components/layout/navigation';
import { ApprovalInboxPage } from '@/features/approvals/ApprovalInboxPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { MfaEnrollPage } from '@/features/auth/MfaEnrollPage';
import { MfaVerifyPage } from '@/features/auth/MfaVerifyPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { BankingPage } from '@/features/banking/BankingPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { BusinessPage } from '@/features/business/BusinessPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { ExecutionsPage } from '@/features/executions/ExecutionsPage';
import { FinancePage } from '@/features/finance/FinancePage';
import { IntegrationsPage } from '@/features/integrations/IntegrationsPage';
import { ComingSoonPage } from '@/features/placeholder/ComingSoonPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

import { CommandCenterRoute, NetworkRoute, ShoppingRoute, WorkflowBuilderRoute } from './lazyPages';

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
          { index: true, element: <CommandCenterRoute /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/integrations', element: <IntegrationsPage /> },
          { path: '/business', element: <BusinessPage /> },
          { path: '/finance', element: <FinancePage /> },
          { path: '/banking', element: <BankingPage /> },
          { path: '/shopping', element: <ShoppingRoute /> },
          { path: '/calendar', element: <CalendarPage /> },
          { path: '/network', element: <NetworkRoute /> },
          { path: '/workflows', element: <WorkflowBuilderRoute /> },
          { path: '/workflows/:automationId', element: <WorkflowBuilderRoute /> },
          { path: '/approvals', element: <ApprovalInboxPage /> },
          { path: '/approvals/:approvalId', element: <ApprovalInboxPage /> },
          { path: '/executions', element: <ExecutionsPage /> },
          { path: '/executions/:executionId', element: <ExecutionsPage /> },
          ...plannedAreas,
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
