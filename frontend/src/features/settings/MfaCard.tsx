import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';

import { useAuthState } from '@/api/auth';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/surface';

export function MfaCard() {
  const { data } = useAuthState();
  const enabled = data?.user.mfa_enabled ?? false;
  return (
    <Panel title="Two-factor authentication" icon={<KeyRound />}>
      <div className="space-y-3">
        {enabled ? (
          <Alert tone="success">An authenticator app (TOTP) protects your account.</Alert>
        ) : (
          <Alert tone="warning">Two-factor authentication is not enabled.</Alert>
        )}
        <p className="text-sm text-ink-muted">
          Lost your device? Reset MFA on the server with{' '}
          <code className="font-mono text-xs text-cyan">
            python -m app.cli reset-mfa --email &lt;email&gt;
          </code>
          . Passkeys and recovery codes are planned.
        </p>
        {!enabled && (
          <Button asChild variant="primary">
            <Link to="/setup/mfa">Enable two-factor authentication</Link>
          </Button>
        )}
      </div>
    </Panel>
  );
}
