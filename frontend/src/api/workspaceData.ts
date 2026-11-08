/** Hooks for workspace-scoped Phase 4 data: Google, calendar/tasks, documents, expenses. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, readCookie, CSRF_COOKIE, toApiError, unwrap } from './client';
import type { components } from './schema';

type S = components['schemas'];
export type CalendarData = S['CalendarOut'];
export type CalendarEventInfo = S['CalendarEventOut'];
export type Task = S['TaskOut'];
export type TaskInput = S['TaskIn'];
export type DocumentInfo = S['DocumentOut'];
export type DocumentUpdate = S['DocumentUpdateIn'];
export type Expense = S['ExpenseOut'];
export type ExpenseInput = S['ExpenseIn'];
export type ExpenseSummaryRow = S['SummaryRow'];

const ws = (id: string | undefined) => ({ workspace_id: id ?? '' });

// ------------------------------------------------------------------ Google

export function useGoogleAuthorize() {
  return useMutation({
    mutationFn: (body: { workspace_id: string; features: ('calendar' | 'gmail' | 'drive')[] }) =>
      unwrap(api.POST('/api/v1/integrations/google/authorize', { body })),
  });
}

export function useGoogleDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      unwrap(
        api.POST('/api/v1/integrations/google/disconnect', { body: { workspace_id: workspaceId } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

// ---------------------------------------------------------- calendar & tasks

export function useCalendar(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['calendar', workspaceId],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/calendar/events', {
          params: { path: ws(workspaceId), query: { days: 14 } },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateEvent(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: S['EventIn']) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/calendar/events', {
          params: { path: ws(workspaceId) },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

export function useTasks(workspaceId: string | undefined, includeDone: boolean) {
  return useQuery({
    queryKey: ['tasks', workspaceId, includeDone],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/tasks', {
          params: { path: ws(workspaceId), query: { include_done: includeDone } },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveTask(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: TaskInput }) =>
      id
        ? unwrap(
            api.PUT('/api/v1/workspaces/{workspace_id}/tasks/{task_id}', {
              params: { path: { ...ws(workspaceId), task_id: id } },
              body,
            }),
          )
        : unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/tasks', {
              params: { path: ws(workspaceId) },
              body,
            }),
          ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useScheduleTask(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/tasks/{task_id}/schedule', {
          params: { path: { ...ws(workspaceId), task_id: taskId } },
          body: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}

// ----------------------------------------------------------------- documents

export function useDocuments(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['documents', workspaceId],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/documents', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

/** Multipart upload (sent with the session's CSRF token like every other unsafe request). */
export function useUploadDocument(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, category }: { file: File; category: string }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('category', category);
      const response = await fetch(`/api/v1/workspaces/${workspaceId ?? ''}/documents`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': readCookie(CSRF_COOKIE) ?? '' },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw toApiError(response.status, body);
      return body as DocumentInfo;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function useUpdateDocument(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DocumentUpdate }) =>
      unwrap(
        api.PATCH('/api/v1/workspaces/{workspace_id}/documents/{document_id}', {
          params: { path: { ...ws(workspaceId), document_id: id } },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function documentContentUrl(workspaceId: string, documentId: string): string {
  return `/api/v1/workspaces/${workspaceId}/documents/${documentId}/content`;
}

// ------------------------------------------------------------------ expenses

export function useExpenses(workspaceId: string | undefined, year: number, month: number | null) {
  return useQuery({
    queryKey: ['expenses', workspaceId, year, month],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/expenses', {
          params: { path: ws(workspaceId), query: month ? { year, month } : { year } },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useExpenseSummary(workspaceId: string | undefined, year: number) {
  return useQuery({
    queryKey: ['expenses', workspaceId, 'summary', year],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/expenses/summary', {
          params: { path: ws(workspaceId), query: { year } },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveExpense(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ExpenseInput }) =>
      id
        ? unwrap(
            api.PUT('/api/v1/workspaces/{workspace_id}/expenses/{expense_id}', {
              params: { path: { ...ws(workspaceId), expense_id: id } },
              body,
            }),
          )
        : unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/expenses', {
              params: { path: ws(workspaceId) },
              body,
            }),
          ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useDeleteExpense(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/expenses/{expense_id}', {
          params: { path: { ...ws(workspaceId), expense_id: id } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}
