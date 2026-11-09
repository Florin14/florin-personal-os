/** Hooks for the banking & reconciliation module (Phase 5). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, CSRF_COOKIE, readCookie, toApiError, unwrap } from './client';
import type { components } from './schema';

type S = components['schemas'];
export type BankAccount = S['AccountOut'];
export type BankAccountInput = S['AccountIn'];
export type BankImport = S['ImportOut'];
export type ImportResult = S['ImportResultOut'];
export type StatementPreview = S['PreviewOut'];
export type BankTransaction = S['TransactionOut'];
export type MatchInfo = S['MatchOut'];
export type MatchCandidate = S['CandidateOut'];
export type TransactionCandidates = S['CandidatesOut'];
export type ReviewItem = S['ReviewItemOut'];
export type MatchTargetType = S['ManualMatchIn']['target_type'];
export type TransactionStatus = BankTransaction['status'];

const ROOT = ['banking'] as const;
const ws = (workspaceId: string | undefined) => ({ workspace_id: workspaceId ?? '' });

/** Any banking change can affect accounts, transactions, review and imports: refresh them all. */
function useInvalidateBanking() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ROOT });
}

export interface TransactionFilters {
  accountId?: string;
  status?: TransactionStatus;
  q?: string;
}

export function useBankAccounts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'accounts'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/banking/accounts', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveBankAccount(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: BankAccountInput }) =>
      id
        ? unwrap(
            api.PUT('/api/v1/workspaces/{workspace_id}/banking/accounts/{account_id}', {
              params: { path: { ...ws(workspaceId), account_id: id } },
              body,
            }),
          )
        : unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/banking/accounts', {
              params: { path: ws(workspaceId) },
              body,
            }),
          ),
    onSuccess: invalidate,
  });
}

export function useDeleteBankAccount(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/banking/accounts/{account_id}', {
          params: { path: { ...ws(workspaceId), account_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Multipart statement upload with the session's CSRF token (openapi-fetch has no FormData typing). */
async function postStatement<T>(url: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(url, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': readCookie(CSRF_COOKIE) ?? '' },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, body);
  return body as T;
}

const importsUrl = (workspaceId: string | undefined, accountId: string) =>
  `/api/v1/workspaces/${workspaceId ?? ''}/banking/accounts/${accountId}/imports`;

/** Parses a statement without storing anything. */
export function usePreviewStatement(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ accountId, file }: { accountId: string; file: File }) =>
      postStatement<StatementPreview>(`${importsUrl(workspaceId, accountId)}/preview`, file),
  });
}

export function useImportStatement(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: ({ accountId, file }: { accountId: string; file: File }) =>
      postStatement<ImportResult>(importsUrl(workspaceId, accountId), file),
    onSuccess: invalidate,
  });
}

export function useBankImports(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'imports'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/banking/imports', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useUndoImport(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/banking/imports/{import_id}', {
          params: { path: { ...ws(workspaceId), import_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useBankTransactions(workspaceId: string | undefined, filters: TransactionFilters) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'transactions', filters],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/banking/transactions', {
          params: {
            path: ws(workspaceId),
            query: {
              ...(filters.accountId ? { account_id: filters.accountId } : {}),
              ...(filters.status ? { status: filters.status } : {}),
              ...(filters.q ? { q: filters.q } : {}),
              limit: 500,
            },
          },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useTransactionCandidates(
  workspaceId: string | undefined,
  transactionId: string | undefined,
) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'candidates', transactionId],
    queryFn: () =>
      unwrap(
        api.GET(
          '/api/v1/workspaces/{workspace_id}/banking/transactions/{transaction_id}/candidates',
          { params: { path: { ...ws(workspaceId), transaction_id: transactionId ?? '' } } },
        ),
      ),
    enabled: Boolean(workspaceId && transactionId),
  });
}

export function useReviewQueue(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'review'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/banking/review', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useReconcile(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/banking/reconcile', {
          params: { path: ws(workspaceId) },
        }),
      ),
    onSuccess: invalidate,
  });
}

export type MatchDecision = 'confirm' | 'reject' | 'remove';

export function useDecideMatch(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: ({ matchId, decision }: { matchId: string; decision: MatchDecision }) => {
      const path = { ...ws(workspaceId), match_id: matchId };
      if (decision === 'remove') {
        return unwrap(
          api.DELETE('/api/v1/workspaces/{workspace_id}/banking/matches/{match_id}', {
            params: { path },
          }),
        );
      }
      return decision === 'confirm'
        ? unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/banking/matches/{match_id}/confirm', {
              params: { path },
            }),
          )
        : unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/banking/matches/{match_id}/reject', {
              params: { path },
            }),
          );
    },
    onSuccess: invalidate,
  });
}

export function useManualMatch(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: ({
      transactionId,
      targetType,
      targetId,
    }: {
      transactionId: string;
      targetType: MatchTargetType;
      targetId: string;
    }) =>
      unwrap(
        api.POST(
          '/api/v1/workspaces/{workspace_id}/banking/transactions/{transaction_id}/matches',
          {
            params: { path: { ...ws(workspaceId), transaction_id: transactionId } },
            body: { target_type: targetType, target_id: targetId },
          },
        ),
      ),
    onSuccess: invalidate,
  });
}

export function useSetIgnored(workspaceId: string | undefined) {
  const invalidate = useInvalidateBanking();
  return useMutation({
    mutationFn: ({ transactionId, ignored }: { transactionId: string; ignored: boolean }) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{workspace_id}/banking/transactions/{transaction_id}/ignored', {
          params: { path: { ...ws(workspaceId), transaction_id: transactionId } },
          body: { ignored },
        }),
      ),
    onSuccess: invalidate,
  });
}
