import { AlertTriangle, Inbox, Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { ApiError, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

function StateFrame({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-4 text-center',
        compact ? 'py-6' : 'py-14',
      )}
    >
      {icon && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-dim [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className={cn('font-display font-medium text-ink', compact ? 'text-sm' : 'text-base')}>
        {title}
      </p>
      {description && <p className="max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({
  label = 'Loading…',
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center gap-3 text-sm text-ink-muted',
        compact ? 'py-6' : 'py-14',
      )}
    >
      <Loader2 className="size-4 animate-spin text-cyan" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({
  error,
  title = 'Could not load this section',
  onRetry,
  compact = false,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (error instanceof ApiError && error.status === 403)
    return <UnauthorizedState compact={compact} />;
  return (
    <div role="alert">
      <StateFrame
        compact={compact}
        icon={<AlertTriangle className="text-danger" />}
        title={title}
        description={errorMessage(error)}
        action={
          onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <StateFrame
      compact={compact}
      icon={<Inbox />}
      title={title}
      {...(description !== undefined && { description })}
      {...(action !== undefined && { action })}
    />
  );
}

export function UnauthorizedState({ compact = false }: { compact?: boolean }) {
  return (
    <StateFrame
      compact={compact}
      icon={<Lock className="text-warning" />}
      title="Access restricted"
      description="Your account does not have permission to view this content."
    />
  );
}
