import { lazy, Suspense } from 'react';

import { LoadingState } from '@/components/feedback/StateViews';

// React Flow is only downloaded when a graph page is opened.
const CommandCenterPage = lazy(() => import('@/features/command/CommandCenterPage'));
const NetworkPage = lazy(() => import('@/features/workflows/NetworkPage'));
const WorkflowBuilderPage = lazy(() => import('@/features/workflows/WorkflowBuilderPage'));

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

export function CommandCenterRoute() {
  return (
    <Suspense fallback={<LoadingState label="Booting command center…" />}>
      <CommandCenterPage />
    </Suspense>
  );
}
