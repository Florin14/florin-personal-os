import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import type { components } from './schema';

export type InvoiceProfile = components['schemas']['ProfileOut'];
export type InvoiceProfileInput = components['schemas']['ProfileIn'];
export type Invoice = components['schemas']['InvoiceOut'];

const root = ['invoicing'] as const;

export function useInvoiceProfiles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...root, workspaceId, 'profiles'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/invoice-profiles', {
          params: { path: { workspace_id: workspaceId ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useInvoices(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...root, workspaceId, 'invoices'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/invoices', {
          params: { path: { workspace_id: workspaceId ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000,
  });
}

export function useInvoicePreview(workspaceId: string | undefined, profileId: string | undefined) {
  return useQuery({
    queryKey: [...root, workspaceId, 'preview', profileId],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/invoice-profiles/{profile_id}/preview', {
          params: { path: { workspace_id: workspaceId ?? '', profile_id: profileId ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId && profileId),
  });
}

export function useSaveInvoiceProfile(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: InvoiceProfileInput }) => {
      const workspace_id = workspaceId ?? '';
      if (id) {
        return unwrap(
          api.PUT('/api/v1/workspaces/{workspace_id}/invoice-profiles/{profile_id}', {
            params: { path: { workspace_id, profile_id: id } },
            body,
          }),
        );
      }
      return unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/invoice-profiles', {
          params: { path: { workspace_id } },
          body,
        }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: root }),
  });
}

export function useDeleteInvoiceProfile(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/invoice-profiles/{profile_id}', {
          params: { path: { workspace_id: workspaceId ?? '', profile_id: id } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: root }),
  });
}

/** Fetches the recommended monthly workflow for a profile (used to create an automation). */
export async function fetchWorkflowTemplate(workspaceId: string, profileId: string) {
  return unwrap(
    api.GET('/api/v1/workspaces/{workspace_id}/invoice-profiles/{profile_id}/workflow-template', {
      params: { path: { workspace_id: workspaceId, profile_id: profileId } },
    }),
  );
}
