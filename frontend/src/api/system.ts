import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from './client';
import { queryKeys } from './queryKeys';

const HEALTH_POLL_MS = 30_000;

/** Polls API readiness; an error means the backend is unreachable or degraded. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => unwrap(api.GET('/api/v1/system/health')),
    refetchInterval: HEALTH_POLL_MS,
    retry: false,
  });
}

export function useSystemInfo() {
  return useQuery({
    queryKey: queryKeys.systemInfo,
    queryFn: () => unwrap(api.GET('/api/v1/system/info')),
    staleTime: 5 * 60_000,
  });
}
