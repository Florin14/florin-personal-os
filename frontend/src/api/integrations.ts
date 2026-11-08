import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import type { components } from './schema';

export type Provider = components['schemas']['ProviderOut'];
export type Connection = components['schemas']['ConnectionOut'];

const KEYS = {
  providers: ['integrations', 'providers'] as const,
  connections: ['integrations', 'connections'] as const,
  root: ['integrations'] as const,
};

export function useProviders() {
  return useQuery({
    queryKey: KEYS.providers,
    queryFn: () => unwrap(api.GET('/api/v1/integrations/providers')),
    staleTime: 10 * 60_000,
  });
}

export function useConnections() {
  return useQuery({
    queryKey: KEYS.connections,
    queryFn: () => unwrap(api.GET('/api/v1/integrations')),
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      provider: string;
      workspace_id: string | null;
      name: string;
      config: Record<string, unknown>;
      secrets: Record<string, unknown>;
    }) => unwrap(api.POST('/api/v1/integrations', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.root }),
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string | null;
      config?: Record<string, unknown> | null;
      secrets?: Record<string, unknown> | null;
      enabled?: boolean | null;
    }) =>
      unwrap(
        api.PATCH('/api/v1/integrations/{connection_id}', {
          params: { path: { connection_id: id } },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.root }),
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/integrations/{connection_id}', {
          params: { path: { connection_id: id } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.root }),
  });
}

export function useCheckConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/api/v1/integrations/{connection_id}/check', {
          params: { path: { connection_id: id } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.root }),
  });
}
