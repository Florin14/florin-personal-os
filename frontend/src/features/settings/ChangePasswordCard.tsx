import PasswordOutlined from '@mui/icons-material/PasswordOutlined';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useState, type SubmitEvent } from 'react';

import { useChangePassword } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { DashboardCard } from '@/features/dashboard/DashboardCard';

export const MIN_PASSWORD_LENGTH = 12;

export function ChangePasswordCard() {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && next === confirm;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setConfirm('');
        },
      },
    );
  };

  return (
    <DashboardCard title="Change password" icon={<PasswordOutlined color="primary" />}>
      <Stack component="form" spacing={2} onSubmit={handleSubmit}>
        {change.isSuccess && (
          <Alert severity="success">Password changed. Other sessions were signed out.</Alert>
        )}
        {change.isError && <Alert severity="error">{errorMessage(change.error)}</Alert>}
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={tooShort}
          helperText={`At least ${MIN_PASSWORD_LENGTH} characters. A passphrase works well.`}
          required
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch}
          helperText={mismatch ? 'Passwords do not match.' : ' '}
          required
        />
        <Button type="submit" variant="contained" disabled={!canSubmit} loading={change.isPending}>
          Update password
        </Button>
      </Stack>
    </DashboardCard>
  );
}
