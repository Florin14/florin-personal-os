import { LockKeyhole } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';

import { useChangePassword } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Panel } from '@/components/ui/surface';

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
    <Panel title="Change password" icon={<LockKeyhole />}>
      <form className="space-y-3" onSubmit={handleSubmit}>
        {change.isSuccess && (
          <Alert tone="success">Password changed. Other sessions were signed out.</Alert>
        )}
        {change.isError && <Alert tone="danger">{errorMessage(change.error)}</Alert>}
        <Field label="Current password" required>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          )}
        </Field>
        <Field
          label="New password"
          required
          help={`At least ${String(MIN_PASSWORD_LENGTH)} characters. A passphrase works well.`}
          error={tooShort ? `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.` : null}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          )}
        </Field>
        <Field
          label="Confirm new password"
          required
          error={mismatch ? 'Passwords do not match.' : null}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={change.isPending}>
          Update password
        </Button>
      </form>
    </Panel>
  );
}
