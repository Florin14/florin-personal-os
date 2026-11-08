import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import { ApiError, errorMessage } from '@/api/client';

interface FrameProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

function StateFrame({ icon, title, description, action, compact = false }: FrameProps) {
  return (
    <Stack
      spacing={1.5}
      sx={{
        alignItems: 'center',
        justifyContent: 'center',
        py: compact ? 3 : 8,
        px: 2,
        textAlign: 'center',
        color: 'text.secondary',
      }}
    >
      {icon}
      <Typography variant={compact ? 'subtitle1' : 'h6'} color="text.primary">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action}
    </Stack>
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
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 2,
        py: compact ? 3 : 8,
      }}
    >
      <CircularProgress size={compact ? 20 : 28} aria-hidden />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
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
  if (error instanceof ApiError && error.status === 403) {
    return <UnauthorizedState compact={compact} />;
  }
  return (
    <div role="alert">
      <StateFrame
        compact={compact}
        icon={
          <ErrorOutlineRounded color="error" fontSize={compact ? 'medium' : 'large'} aria-hidden />
        }
        title={title}
        description={errorMessage(error)}
        action={
          onRetry && (
            <Button variant="outlined" onClick={onRetry}>
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
      icon={<InboxOutlined fontSize={compact ? 'medium' : 'large'} aria-hidden />}
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
      icon={<LockOutlined color="warning" fontSize={compact ? 'medium' : 'large'} aria-hidden />}
      title="Access restricted"
      description="Your account does not have permission to view this content."
    />
  );
}
