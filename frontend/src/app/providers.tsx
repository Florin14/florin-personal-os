import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { useUiStore } from '@/stores/uiStore';

import { createQueryClient } from './queryClient';
import { buildTheme } from './theme';

function ThemedApp({ children }: { children: ReactNode }) {
  const preference = useUiStore((s) => s.themePreference);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const mode = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
  const theme = useMemo(() => buildTheme(mode, reducedMotion), [mode, reducedMotion]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}

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
      <ThemedApp>{children}</ThemedApp>
    </QueryClientProvider>
  );
}
