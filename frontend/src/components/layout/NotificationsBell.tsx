import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
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

const SEVERITY_COLOR: Record<string, string> = {
  error: 'error.main',
  warning: 'warning.main',
  success: 'success.main',
  info: 'info.main',
};

export function NotificationsBell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const unread = useUnreadCount();
  const list = useNotifications(Boolean(anchor));
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const count = unread.data?.unread ?? 0;
  const label = count ? `Notifications, ${count} unread` : 'Notifications';

  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    setAnchor(null);
    if (n.link) void navigate(n.link);
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton aria-label={label} onClick={(e) => setAnchor(e.currentTarget)} color="inherit">
          <Badge badgeContent={count} color="error" max={99}>
            <NotificationsNoneRounded />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: '95vw' } } }}
      >
        <Stack direction="row" sx={{ px: 2, py: 1.5, alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 600 }}>
            Notifications
          </Typography>
          <Button size="small" onClick={() => markAll.mutate()} disabled={count === 0}>
            Mark all read
          </Button>
        </Stack>
        <Divider />
        {list.isPending ? (
          <LoadingState compact />
        ) : list.isError ? (
          <ErrorState compact error={list.error} />
        ) : list.data.length === 0 ? (
          <EmptyState compact title="You're all caught up" />
        ) : (
          <List dense sx={{ maxHeight: 420, overflowY: 'auto' }} aria-label="Recent notifications">
            {list.data.map((n) => (
              <ListItemButton key={n.id} onClick={() => open(n)} sx={{ alignItems: 'flex-start' }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    mt: 1,
                    mr: 1.5,
                    flexShrink: 0,
                    bgcolor: n.read_at
                      ? 'transparent'
                      : (SEVERITY_COLOR[n.severity] ?? 'info.main'),
                  }}
                />
                <ListItemText
                  primary={n.title}
                  secondary={`${n.body ? `${n.body} · ` : ''}${relativeTime(n.created_at)}`}
                  slotProps={{
                    primary: { sx: { fontWeight: n.read_at ? 400 : 600 } },
                    secondary: { sx: { overflow: 'hidden', textOverflow: 'ellipsis' } },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
