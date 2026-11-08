import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import { queryKeys } from './queryKeys';
import type { ApprovalStatus } from './types';

export function useApprovals(status?: ApprovalStatus) {
  return useQuery({
    queryKey: queryKeys.approvals(status),
    queryFn: () =>
      unwrap(api.GET('/api/v1/approvals', { params: { query: status ? { status } : {} } })),
    refetchInterval: 30_000,
  });
}

export function useApproval(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.approval(id ?? ''),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/approvals/{approval_id}', { params: { path: { approval_id: id ?? '' } } }),
      ),
    enabled: Boolean(id),
  });
}

export interface DecisionInput {
  id: string;
  decision: 'approve' | 'reject';
  note?: string;
  mfaCode?: string;
}

export function useDecideApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note, mfaCode }: DecisionInput) =>
      unwrap(
        api.POST('/api/v1/approvals/{approval_id}/decision', {
          params: { path: { approval_id: id } },
          body: {
            decision,
            note: note?.trim() ? note.trim() : null,
            mfa_code: mfaCode ? mfaCode : null,
          },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.approvalsRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.executionsRoot }),
      ]);
    },
  });
}
