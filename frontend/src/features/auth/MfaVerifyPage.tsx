import { useState, type SubmitEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { useAuthState, useLogout, useVerifyMfa } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { AuthLayout } from './AuthLayout';
import { CodeField } from './CodeField';
import { routeForAuthState, ROUTES } from './authRouting';

export function MfaVerifyPage() {
  const auth = useAuthState();
  const verify = useVerifyMfa();
  const logout = useLogout();
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  if (auth.isPending) return <LoadingState label="Checking session…" />;
  const target = routeForAuthState(auth.data);
  if (target !== ROUTES.mfaVerify) return <Navigate to={target} replace />;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    verify.mutate(code, {
      onSuccess: (state) => void navigate(routeForAuthState(state), { replace: true }),
      onError: () => setCode(''),
    });
  };

  return (
    <AuthLayout
      title="Two-factor verification"
      subtitle="Enter the code from your authenticator app."
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {verify.isError && <Alert tone="danger">{errorMessage(verify.error)}</Alert>}
        <CodeField value={code} onChange={setCode} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={code.length !== 6}
          loading={verify.isPending}
        >
          Verify
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => logout.mutate(undefined, { onSettled: () => void navigate(ROUTES.login) })}
        >
          Use a different account
        </Button>
      </form>
    </AuthLayout>
  );
}
