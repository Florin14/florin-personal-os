import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import { queryKeys } from './queryKeys';
import type { ExecutionStatus, JobStats } from './types';

const ACTIVE: ExecutionStatus[] = ['pending', 'running', 'waiting_approval', 'waiting_delay'];

export function isActive(status: ExecutionStatus): boolean {
  return ACTIVE.includes(status);
}

export function useAutomations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.automations(workspaceId ?? ''),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/automations', {
          params: { path: { workspace_id: workspaceId ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useAutomation(workspaceId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.automation(workspaceId ?? '', id ?? ''),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/automations/{automation_id}', {
          params: { path: { workspace_id: workspaceId ?? '', automation_id: id ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId && id),
  });
}

export function useAutomationVersions(workspaceId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.automationVersions(workspaceId ?? '', id ?? ''),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/automations/{automation_id}/versions', {
          params: { path: { workspace_id: workspaceId ?? '', automation_id: id ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId && id),
  });
}

export interface AutomationInput {
  name: string;
  description: string;
  definition: Record<string, unknown>;
}

export function useSaveAutomation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AutomationInput }) => {
      const workspace_id = workspaceId ?? '';
      if (id) {
        return unwrap(
          api.PUT('/api/v1/workspaces/{workspace_id}/automations/{automation_id}', {
            params: { path: { workspace_id, automation_id: id } },
            body: input,
          }),
        );
      }
      return unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/automations', {
          params: { path: { workspace_id } },
          body: input,
        }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.automationRoot }),
  });
}

export function useSetAutomationEnabled(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{workspace_id}/automations/{automation_id}/enabled', {
          params: { path: { workspace_id: workspaceId ?? '', automation_id: id } },
          body: { enabled },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.automationRoot }),
  });
}

export function useRunAutomation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      dryRun,
      payload,
    }: {
      id: string;
      dryRun: boolean;
      payload: Record<string, unknown>;
    }) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/automations/{automation_id}/run', {
          params: { path: { workspace_id: workspaceId ?? '', automation_id: id } },
          body: { dry_run: dryRun, payload },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.executionsRoot }),
  });
}

export function useExecutions(workspaceId: string | undefined, status?: ExecutionStatus) {
  return useQuery({
    queryKey: queryKeys.executions(workspaceId ?? '', status),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/executions', {
          params: {
            path: { workspace_id: workspaceId ?? '' },
            query: status ? { status, limit: 100 } : { limit: 100 },
          },
        }),
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: (query) =>
      query.state.data?.some((e) => isActive(e.status)) ? 3_000 : 30_000,
  });
}

export function useExecution(workspaceId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.execution(workspaceId ?? '', id ?? ''),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/executions/{execution_id}', {
          params: { path: { workspace_id: workspaceId ?? '', execution_id: id ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId && id),
    refetchInterval: (query) =>
      query.state.data && isActive(query.state.data.status) ? 2_000 : false,
  });
}

export function useCancelExecution(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/executions/{execution_id}/cancel', {
          params: { path: { workspace_id: workspaceId ?? '', execution_id: id } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.executionsRoot }),
  });
}

export function useActionCatalog() {
  return useQuery({
    queryKey: queryKeys.actions,
    queryFn: () => unwrap(api.GET('/api/v1/automation/actions')),
    staleTime: 10 * 60_000,
  });
}

export function useControls() {
  return useQuery({
    queryKey: queryKeys.controls,
    queryFn: () => unwrap(api.GET('/api/v1/automation/controls')),
    refetchInterval: 60_000,
  });
}

export function useSetEmergencyStop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ active, reason }: { active: boolean; reason?: string }) =>
      unwrap(
        api.PUT('/api/v1/automation/controls/emergency-stop', {
          body: { active, reason: reason ?? null },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.controls, data),
  });
}

// ------------------------------------------------------------------ admin: jobs & audit

export function useJobs(status: 'failed' | 'queued' | 'running' | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jobs(status),
    queryFn: () => unwrap(api.GET('/api/v1/jobs', { params: { query: status ? { status } : {} } })),
    enabled,
  });
}

export function useJobStats(enabled: boolean) {
  return useQuery<JobStats>({
    queryKey: queryKeys.jobStats,
    queryFn: () => unwrap(api.GET('/api/v1/jobs/stats')),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useRetryJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/api/v1/jobs/{job_id}/retry', { params: { path: { job_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobsRoot }),
  });
}

export function useAuditLog(actionPrefix?: string) {
  return useQuery({
    queryKey: queryKeys.audit(actionPrefix),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/audit', {
          params: {
            query: actionPrefix ? { action_prefix: actionPrefix, limit: 50 } : { limit: 50 },
          },
        }),
      ),
  });
}
