import QRCode from 'qrcode';
import { useState, type SubmitEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { useAuthState, useBeginTotpEnrollment, useConfirmTotpEnrollment } from '@/api/auth';
import { errorMessage } from '@/api/client';
import type { TotpEnrollment } from '@/api/types';
import { LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { AuthLayout } from './AuthLayout';
import { CodeField } from './CodeField';
import { routeForAuthState, ROUTES } from './authRouting';

interface PreparedEnrollment extends TotpEnrollment {
  qrDataUrl: string | null;
}

export function MfaEnrollPage() {
  const auth = useAuthState();
  const begin = useBeginTotpEnrollment();
  const confirm = useConfirmTotpEnrollment();
  const navigate = useNavigate();
  const [enrollment, setEnrollment] = useState<PreparedEnrollment | null>(null);
  const [code, setCode] = useState('');

  if (auth.isPending) return <LoadingState label="Checking session…" />;
  const voluntary = auth.data?.next_step === 'none' && !auth.data.user.mfa_enabled;
  const target = routeForAuthState(auth.data);
  if (target !== ROUTES.mfaEnroll && !voluntary) return <Navigate to={target} replace />;

  // Started by an explicit click (not an effect) so exactly one secret is generated.
  const start = () => {
    begin.mutate(undefined, {
      onSuccess: (data) => {
        setEnrollment({ ...data, qrDataUrl: null });
        // The QR code is rendered locally; the secret is never sent to third parties.
        QRCode.toDataURL(data.provisioning_uri, { margin: 1, width: 220 })
          .then((qrDataUrl) => setEnrollment({ ...data, qrDataUrl }))
          .catch(() => undefined);
      },
    });
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    confirm.mutate(code, {
      onSuccess: () => {
        setEnrollment(null);
        void navigate(ROUTES.home, { replace: true });
      },
      onError: () => setCode(''),
    });
  };

  return (
    <AuthLayout
      title="Set up two-factor authentication"
      subtitle="Protect your account with an authenticator app (TOTP)."
    >
      {!enrollment ? (
        <div className="flex flex-col gap-4">
          {begin.isError && <Alert tone="danger">{errorMessage(begin.error)}</Alert>}
          <p className="text-sm text-ink-muted">
            You need an authenticator app such as Aegis, 2FAS, Google Authenticator or 1Password.
          </p>
          <Button variant="primary" size="lg" onClick={start} loading={begin.isPending}>
            Set up authenticator app
          </Button>
          {voluntary && (
            <Button variant="ghost" onClick={() => void navigate(ROUTES.home)}>
              Not now
            </Button>
          )}
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {confirm.isError && <Alert tone="danger">{errorMessage(confirm.error)}</Alert>}
          <p className="text-sm">1. Scan this QR code with your authenticator app.</p>
          {enrollment.qrDataUrl && (
            <img
              src={enrollment.qrDataUrl}
              alt="QR code for authenticator app setup"
              className="mx-auto size-52 rounded-md bg-white p-2"
            />
          )}
          <p className="text-xs text-ink-muted">Cannot scan? Enter this key manually:</p>
          <p
            data-testid="totp-secret"
            className="text-center font-mono text-sm break-all text-cyan"
          >
            {enrollment.secret}
          </p>
          <p className="text-sm">2. Enter the 6-digit code the app shows.</p>
          <CodeField value={code} onChange={setCode} />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={code.length !== 6}
            loading={confirm.isPending}
          >
            Enable two-factor authentication
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
