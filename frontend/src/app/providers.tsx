import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState, type ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/overlay';

import { createQueryClient } from './queryClient';

export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      {/* Animations are disabled automatically for users who prefer reduced motion. */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider>{children}</TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
