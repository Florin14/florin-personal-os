import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from './client';
import { queryKeys } from './queryKeys';

export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => unwrap(api.GET('/api/v1/workspaces')),
    staleTime: 5 * 60_000,
  });
}
