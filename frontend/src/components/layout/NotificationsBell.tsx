import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  useMarkAllRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/api/notifications';
import type { Notification } from '@/api/types';
import { relativeTime } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import { StatusDot, type Tone } from '@/components/ui/surface';

const SEVERITY: Record<string, Tone> = {
  error: 'danger',
  warning: 'warning',
  success: 'success',
  info: 'info',
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const count = unread.data?.unread ?? 0;

  const openItem = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) void navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={count ? `Notifications, ${String(count)} unread` : 'Notifications'}
          className="relative"
        >
          <Bell />
          {count > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-mono text-[9px] font-bold text-white shadow-[0_0_10px_var(--color-danger)]">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,94vw)] p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-display text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={count === 0}>
            Mark all read
          </Button>
        </div>
        {list.isPending ? (
          <LoadingState compact />
        ) : list.isError ? (
          <ErrorState compact error={list.error} />
        ) : list.data.length === 0 ? (
          <EmptyState compact title="You're all caught up" />
        ) : (
          <ul className="max-h-[420px] overflow-y-auto py-1" aria-label="Recent notifications">
            {list.data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-electric/[0.07]"
                >
                  <span className="mt-1.5">
                    <StatusDot tone={n.read_at ? 'neutral' : (SEVERITY[n.severity] ?? 'info')} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        n.read_at
                          ? 'block text-sm text-ink-muted'
                          : 'block text-sm font-medium text-ink'
                      }
                    >
                      {n.title}
                    </span>
                    <span className="block truncate text-xs text-ink-dim">
                      {n.body ? `${n.body} · ` : ''}
                      {relativeTime(n.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
