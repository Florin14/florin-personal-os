import { useState, type SubmitEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { useAuthState, useLogin } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

import { AuthLayout } from './AuthLayout';
import { routeForAuthState, ROUTES } from './authRouting';

export function LoginPage() {
  const auth = useAuthState();
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (auth.isPending) return <LoadingState label="Checking session…" />;
  if (auth.data?.next_step === 'none') return <Navigate to={ROUTES.home} replace />;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: (state) => {
          setPassword('');
          void navigate(routeForAuthState(state), { replace: true });
        },
      },
    );
  };

  return (
    <AuthLayout title="Sign in" subtitle="Personal OS command center">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {login.isError && <Alert tone="danger">{errorMessage(login.error)}</Alert>}
        <Field label="Email" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Password" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={login.isPending}
          className="mt-1"
        >
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
