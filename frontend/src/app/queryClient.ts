import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
    // Any 401 means the session ended: switch the app to the signed-out state.
    queryCache: new QueryCache({ onError: (error) => handleAuthError(client, error) }),
    mutationCache: new MutationCache({ onError: (error) => handleAuthError(client, error) }),
  });
  return client;
}

function handleAuthError(client: QueryClient, error: unknown): void {
  if (error instanceof ApiError && error.isUnauthenticated) {
    const isAuthFlowError =
      error.code === 'invalid_credentials' || error.code === 'invalid_mfa_code';
    if (!isAuthFlowError) client.setQueryData(queryKeys.auth, null);
  }
}
