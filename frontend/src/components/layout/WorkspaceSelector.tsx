import { Building2, User } from 'lucide-react';

import { useWorkspaces } from '@/api/workspaces';
import { Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/** Switches between the personal and business (e.g. FLOZITECH SRL) workspaces. */
export function WorkspaceSelector({ compact = false }: { compact?: boolean }) {
  const { data, isPending, isError } = useWorkspaces();
  const current = useCurrentWorkspace();
  const setCurrent = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  if (isPending) return <Skeleton className="h-9 w-full" />;
  if (isError || !current || !data.length) {
    return (
      <p className="text-xs text-ink-dim">{isError ? 'Workspaces unavailable' : 'No workspace'}</p>
    );
  }
  const Icon = current.kind === 'business' ? Building2 : User;
  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-cyan"
        aria-hidden
      />
      <Select
        aria-label="Workspace"
        value={current.id}
        onChange={(e) => setCurrent(e.target.value)}
        className={compact ? 'h-9 pl-8 text-xs' : 'h-9 pl-8'}
      >
        {data.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.kind === 'business' ? ' · Business' : ''}
          </option>
        ))}
      </Select>
    </div>
  );
}
