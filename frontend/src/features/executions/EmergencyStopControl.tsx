import { OctagonX } from 'lucide-react';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import { useControls, useSetEmergencyStop } from '@/api/automation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Badge } from '@/components/ui/surface';

/** Shows the emergency stop state; administrators can toggle it (with confirmation). */
export function EmergencyStopControl({ canChange }: { canChange: boolean }) {
  const controls = useControls();
  const setStop = useSetEmergencyStop();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const active = controls.data?.emergency_stop ?? false;

  if (!canChange)
    return active ? (
      <Badge tone="danger" dot>
        Emergency stop active
      </Badge>
    ) : null;

  const confirm = () => {
    setStop.mutate(
      { active: !active, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
        },
      },
    );
  };

  return (
    <>
      <Button
        variant={active ? 'success' : 'danger'}
        onClick={() => setOpen(true)}
        disabled={controls.isPending}
      >
        <OctagonX /> {active ? 'Release emergency stop' : 'Emergency stop'}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={active ? 'Release the emergency stop?' : 'Stop all side-effecting automations?'}
        description={
          active
            ? 'Automations will be able to perform external actions again.'
            : 'Steps that change external systems (invoices, messages, devices) fail until released. Read-only steps keep working.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={active ? 'success' : 'danger'}
              onClick={confirm}
              loading={setStop.isPending}
            >
              {active ? 'Release' : 'Activate stop'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {setStop.isError && <Alert tone="danger">{errorMessage(setStop.error)}</Alert>}
          <Field label="Reason">
            {(p) => (
              <Input
                {...p}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
