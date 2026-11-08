import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import QRCode from 'qrcode';
import { useState, type SubmitEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { useAuthState, useBeginTotpEnrollment, useConfirmTotpEnrollment } from '@/api/auth';
import { errorMessage } from '@/api/client';
import type { TotpEnrollment } from '@/api/types';
import { LoadingState } from '@/components/feedback/StateViews';

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
          .catch(() => undefined); // manual key entry remains available
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
        <Stack spacing={2}>
          {begin.isError && <Alert severity="error">{errorMessage(begin.error)}</Alert>}
          <Typography variant="body2" color="text.secondary">
            Two-factor authentication is required. You need an authenticator app such as Aegis,
            2FAS, Google Authenticator or 1Password.
          </Typography>
          <Button variant="contained" size="large" onClick={start} loading={begin.isPending}>
            Set up authenticator app
          </Button>
        </Stack>
      ) : (
        <Stack component="form" spacing={2} onSubmit={handleSubmit}>
          {confirm.isError && <Alert severity="error">{errorMessage(confirm.error)}</Alert>}
          <Typography variant="body2">1. Scan this QR code with your authenticator app.</Typography>
          {enrollment.qrDataUrl && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box
                component="img"
                src={enrollment.qrDataUrl}
                alt="QR code for authenticator app setup"
                sx={{ width: 220, height: 220, borderRadius: 2, bgcolor: '#fff', p: 1 }}
              />
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            Cannot scan? Enter this key manually:
          </Typography>
          <Typography
            data-testid="totp-secret"
            sx={{ fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'center' }}
          >
            {enrollment.secret}
          </Typography>
          <Typography variant="body2">2. Enter the 6-digit code the app shows.</Typography>
          <CodeField value={code} onChange={setCode} />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={code.length !== 6}
            loading={confirm.isPending}
          >
            Enable two-factor authentication
          </Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
