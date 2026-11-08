import PanToolOutlined from '@mui/icons-material/PanToolOutlined';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import { useControls, useSetEmergencyStop } from '@/api/automation';

/** Shows the emergency stop state; administrators can toggle it (with confirmation). */
export function EmergencyStopControl({ canChange }: { canChange: boolean }) {
  const controls = useControls();
  const setStop = useSetEmergencyStop();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const active = controls.data?.emergency_stop ?? false;

  if (!canChange) {
    return active ? (
      <Chip color="error" icon={<PanToolOutlined />} label="Emergency stop active" />
    ) : null;
  }

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
        color={active ? 'success' : 'error'}
        variant={active ? 'contained' : 'outlined'}
        startIcon={<PanToolOutlined />}
        onClick={() => setOpen(true)}
        disabled={controls.isPending}
      >
        {active ? 'Release emergency stop' : 'Emergency stop'}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="estop-title">
        <DialogTitle id="estop-title">
          {active ? 'Release the emergency stop?' : 'Stop all side-effecting automations?'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {active
              ? 'Automations will be able to perform external actions again.'
              : 'Steps that change external systems (invoices, messages, devices) will fail until released. Read-only steps keep working.'}
          </DialogContentText>
          {setStop.isError && <Alert severity="error">{errorMessage(setStop.error)}</Alert>}
          <TextField
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            color={active ? 'success' : 'error'}
            variant="contained"
            onClick={confirm}
            loading={setStop.isPending}
          >
            {active ? 'Release' : 'Activate stop'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
