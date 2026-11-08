import { Alert } from '@mui/material';

import { useHealth } from '@/api/system';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/** Shows offline (browser) and disconnected/degraded (API) states app-wide. */
export function ConnectionBanner() {
  const online = useOnlineStatus();
  const health = useHealth();

  if (!online) {
    return (
      <Alert severity="warning" variant="filled" role="status" sx={{ borderRadius: 0 }}>
        You are offline. Changes cannot be saved until the connection is restored.
      </Alert>
    );
  }
  if (health.isError) {
    return (
      <Alert severity="error" variant="filled" role="status" sx={{ borderRadius: 0 }}>
        Cannot reach the Personal OS server. Retrying automatically…
      </Alert>
    );
  }
  return null;
}
