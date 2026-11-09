import { lazy, Suspense } from 'react';

import { LoadingState } from '@/components/feedback/StateViews';

// React Flow is only downloaded when a graph page is opened.
const CommandCenterPage = lazy(() => import('@/features/command/CommandCenterPage'));
const NetworkPage = lazy(() => import('@/features/workflows/NetworkPage'));
const WorkflowBuilderPage = lazy(() => import('@/features/workflows/WorkflowBuilderPage'));
// Recharts (price history) is only downloaded with the shopping page.
const ShoppingPage = lazy(() => import('@/features/shopping/ShoppingPage'));
const SmartHomePage = lazy(() => import('@/features/smarthome/SmartHomePage'));

export function SmartHomeRoute() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SmartHomePage />
    </Suspense>
  );
}

export function NetworkRoute() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NetworkPage />
    </Suspense>
  );
}

export function WorkflowBuilderRoute() {
  return (
    <Suspense fallback={<LoadingState />}>
      <WorkflowBuilderPage />
    </Suspense>
  );
}

export function ShoppingRoute() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ShoppingPage />
    </Suspense>
  );
}

export function CommandCenterRoute() {
  return (
    <Suspense fallback={<LoadingState label="Booting command center…" />}>
      <CommandCenterPage />
    </Suspense>
  );
}
