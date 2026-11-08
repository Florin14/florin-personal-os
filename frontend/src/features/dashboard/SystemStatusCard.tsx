import MonitorHeartOutlined from '@mui/icons-material/MonitorHeartOutlined';
import { Chip, Stack, Typography } from '@mui/material';

import { useHealth, useSystemInfo } from '@/api/system';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';

import { DashboardCard } from './DashboardCard';

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Chip
        size="small"
        label={value}
        color={ok ? 'success' : 'error'}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    </Stack>
  );
}

export function SystemStatusCard() {
  const health = useHealth();
  const info = useSystemInfo();

  return (
    <DashboardCard title="System status" icon={<MonitorHeartOutlined color="primary" />}>
      {info.isPending ? (
        <LoadingState compact />
      ) : info.isError ? (
        <ErrorState compact error={info.error} onRetry={() => void info.refetch()} />
      ) : (
        <Stack spacing={1.5}>
          <StatusRow
            label="API"
            ok={!health.isError}
            value={health.isError ? 'Unreachable' : 'Online'}
          />
          <StatusRow
            label="Database"
            ok={health.data?.database === 'ok'}
            value={health.data?.database === 'ok' ? 'Connected' : 'Unavailable'}
          />
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Version
            </Typography>
            <Typography variant="body2">
              {info.data.version} · {info.data.environment}
            </Typography>
          </Stack>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Active modules
            </Typography>
            <Typography variant="body2">{info.data.modules.length}</Typography>
          </Stack>
        </Stack>
      )}
    </DashboardCard>
  );
}
