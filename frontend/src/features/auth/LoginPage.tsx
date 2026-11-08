import { Alert, Button, Stack, TextField } from '@mui/material';
import { useState, type SubmitEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { useAuthState, useLogin } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { LoadingState } from '@/components/feedback/StateViews';

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
      <Stack component="form" spacing={2} onSubmit={handleSubmit}>
        {login.isError && <Alert severity="error">{errorMessage(login.error)}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" variant="contained" size="large" loading={login.isPending}>
          Sign in
        </Button>
      </Stack>
    </AuthLayout>
  );
}
