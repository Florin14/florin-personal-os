/** Hooks for freelance opportunities (Phase 6, ADR-024) and optional AI (ADR-023). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import type { components } from './schema';

type S = components['schemas'];
export type OpportunityProfile = S['OpportunityProfileOut'];
export type OpportunityProfileInput = S['OpportunityProfileIn'];
export type OpportunitySource = S['OpportunitySourceOut'];
export type FeedSourceInput = S['FeedSourceIn'];
export type Opportunity = S['OpportunityOut'];
export type ManualOpportunityInput = S['ManualOpportunityIn'];
export type OpportunityStatus = Opportunity['status'];
export type AiStatus = S['AiStatusOut'];
export type AiUsage = S['AiUsageOut'];

const ROOT = ['opportunities'] as const;
const AI = ['ai'] as const;
const ws = (workspaceId: string | undefined) => ({ workspace_id: workspaceId ?? '' });

function useInvalidate(...keys: (readonly string[])[]) {
  const queryClient = useQueryClient();
  return () => Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export interface ListingFilters {
  status?: OpportunityStatus;
  minScore: number;
  q?: string;
}

export function useOpportunities(workspaceId: string | undefined, filters: ListingFilters) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'listings', filters],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/opportunities/listings', {
          params: {
            path: ws(workspaceId),
            query: {
              min_score: filters.minScore,
              limit: 300,
              ...(filters.status ? { status: filters.status } : {}),
              ...(filters.q ? { q: filters.q } : {}),
            },
          },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useAddOpportunity(workspaceId: string | undefined) {
  const invalidate = useInvalidate(ROOT);
  return useMutation({
    mutationFn: (body: ManualOpportunityInput) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/opportunities/listings', {
          params: { path: ws(workspaceId) },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useSetOpportunityStatus(workspaceId: string | undefined) {
  const invalidate = useInvalidate(ROOT);
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: OpportunityStatus }) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{workspace_id}/opportunities/listings/{listing_id}/status', {
          params: { path: { ...ws(workspaceId), listing_id: id } },
          body: { status },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useSummarizeOpportunity(workspaceId: string | undefined) {
  const invalidate = useInvalidate(ROOT, AI);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/opportunities/listings/{listing_id}/summary', {
          params: { path: { ...ws(workspaceId), listing_id: id } },
        }),
      ),
    // Refusals are recorded as usage too, so refresh both on any outcome.
    onSettled: invalidate,
  });
}

export function useOpportunityProfile(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'profile'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/opportunities/profile', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveOpportunityProfile(workspaceId: string | undefined) {
  const invalidate = useInvalidate(ROOT);
  return useMutation({
    mutationFn: (body: OpportunityProfileInput) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{workspace_id}/opportunities/profile', {
          params: { path: ws(workspaceId) },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useOpportunitySources(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'sources'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/opportunities/sources', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveFeed(workspaceId: string | undefined) {
  const invalidate = useInvalidate(ROOT);
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: FeedSourceInput }) =>
      id
        ? unwrap(
            api.PUT('/api/v1/workspaces/{workspace_id}/opportunities/sources/{source_id}', {
              params: { path: { ...ws(workspaceId), source_id: id } },
              body,
            }),
          )
        : unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/opportunities/sources', {
              params: { path: ws(workspaceId) },
              body,
            }),
          ),
    onSuccess: invalidate,
  });
}

export function useDeleteSource(workspaceId: string | undefined) {
  const invalidate = useInvalidate(ROOT);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/opportunities/sources/{source_id}', {
          params: { path: { ...ws(workspaceId), source_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function usePollSource(workspaceId: string | undefined) {
  const invalidate = useInvalidate(ROOT);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/opportunities/sources/{source_id}/poll', {
          params: { path: { ...ws(workspaceId), source_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

// ------------------------------------------------------------------------ AI

export function useAiStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...AI, workspaceId, 'status'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/ai', { params: { path: ws(workspaceId) } }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useAiUsage(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...AI, workspaceId, 'usage'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/ai/usage', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSetAiFeatures(workspaceId: string | undefined) {
  const invalidate = useInvalidate(AI);
  return useMutation({
    mutationFn: (enabledFeatures: string[]) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{workspace_id}/ai/features', {
          params: { path: ws(workspaceId) },
          body: { enabled_features: enabledFeatures },
        }),
      ),
    onSuccess: invalidate,
  });
}
