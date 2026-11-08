import { WifiOff, ServerCrash } from 'lucide-react';

import { useHealth } from '@/api/system';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/** Offline (browser) and disconnected (API) states, app-wide. */
export function ConnectionBanner() {
  const online = useOnlineStatus();
  const health = useHealth();
  if (!online) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning"
      >
        <WifiOff className="size-3.5" aria-hidden />
        You are offline. Changes cannot be saved until the connection is restored.
      </div>
    );
  }
  if (health.isError) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger"
      >
        <ServerCrash className="size-3.5" aria-hidden />
        Cannot reach the Personal OS server. Retrying automatically…
      </div>
    );
  }
  return null;
}
