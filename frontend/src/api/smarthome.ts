/** Home Assistant discovery, guarded controls and command history (ADR-025). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import type { components } from './schema';

type S = components['schemas'];
export type HomeDevice = S['HomeDeviceOut'];
export type HomeCommand = S['HomeCommandOut'];
export type HomeDevicePolicy = S['HomeDevicePolicyIn'];
export type HomeCommandInput = S['HomeCommandIn'];

const ROOT = ['smarthome'] as const;
const ws = (workspaceId: string | undefined) => ({ workspace_id: workspaceId ?? '' });

function useInvalidateHome() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ROOT });
}

export function useHomeStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'status'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/smarthome/status', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });
}

export function useHomeDevices(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'devices'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/smarthome/devices', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });
}

export function useHomeCommands(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'commands'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/smarthome/commands', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });
}

export function useSyncHome(workspaceId: string | undefined) {
  const invalidate = useInvalidateHome();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/smarthome/sync', {
          params: { path: ws(workspaceId) },
        }),
      ),
    onSettled: invalidate,
  });
}

export function useConfigureHomeDevice(workspaceId: string | undefined) {
  const invalidate = useInvalidateHome();
  return useMutation({
    mutationFn: ({ deviceId, body }: { deviceId: string; body: HomeDevicePolicy }) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{workspace_id}/smarthome/devices/{device_id}/policy', {
          params: { path: { ...ws(workspaceId), device_id: deviceId } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useHomeCommand(workspaceId: string | undefined) {
  const invalidate = useInvalidateHome();
  return useMutation({
    mutationFn: ({ deviceId, body }: { deviceId: string; body: HomeCommandInput }) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/smarthome/devices/{device_id}/commands', {
          params: { path: { ...ws(workspaceId), device_id: deviceId } },
          body,
        }),
      ),
    onSettled: invalidate,
  });
}
