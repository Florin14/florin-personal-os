import { useWorkspaces } from '@/api/workspaces';
import type { Workspace } from '@/api/types';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/** Resolves the selected workspace, falling back to the first accessible one. */
export function useCurrentWorkspace(): Workspace | undefined {
  const { data } = useWorkspaces();
  const currentId = useWorkspaceStore((s) => s.currentWorkspaceId);
  if (!data || data.length === 0) return undefined;
  return data.find((w) => w.id === currentId) ?? data[0];
}
