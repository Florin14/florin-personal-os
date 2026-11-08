import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import {
  useSaveInvoiceProfile,
  type InvoiceProfile,
  type InvoiceProfileInput,
} from '@/api/invoicing';

const EMPTY: InvoiceProfileInput = {
  name: '',
  enabled: true,
  client_name: '',
  client_cif: null,
  client_rc: null,
  client_address: null,
  client_city: null,
  client_state: null,
  client_country: 'Romania',
  client_email: null,
  client_vat_payer: false,
  series_name: '',
  language: 'RO',
  currency: 'RON',
  description: 'Servicii {month_name} {year}',
  measuring_unit: 'buc',
  unit_price: '0.00',
  quantity: '1',
  vat_name: null,
  vat_percentage: null,
  vat_included: false,
  billing_period: 'previous_month',
  due_days: 15,
  timezone: 'Europe/Bucharest',
  mentions: null,
  send_email: false,
};

type TextKey =
  | 'name'
  | 'client_name'
  | 'client_cif'
  | 'client_rc'
  | 'client_address'
  | 'client_city'
  | 'client_state'
  | 'client_country'
  | 'client_email'
  | 'series_name'
  | 'currency'
  | 'description'
  | 'measuring_unit'
  | 'unit_price'
  | 'quantity'
  | 'vat_name'
  | 'vat_percentage'
  | 'timezone'
  | 'mentions';

function fromProfile(p: InvoiceProfile): InvoiceProfileInput {
  const result = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as (keyof InvoiceProfileInput)[]) {
    (result as Record<string, unknown>)[key] = p[key];
  }
  return result;
}

export function ProfileDialog({
  workspaceId,
  profile,
  onClose,
}: {
  workspaceId: string;
  profile?: InvoiceProfile;
  onClose: () => void;
}) {
  const save = useSaveInvoiceProfile(workspaceId);
  const [form, setForm] = useState<InvoiceProfileInput>(() =>
    profile ? fromProfile(profile) : EMPTY,
  );

  const text = (
    key: TextKey,
    label: string,
    opts: { required?: boolean; helper?: string; md?: number } = {},
  ) => (
    <Grid size={{ xs: 12, md: opts.md ?? 6 }}>
      <TextField
        label={label}
        value={String(form[key] ?? '')}
        required={opts.required}
        helperText={opts.helper}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            [key]: e.target.value === '' && !opts.required ? null : e.target.value,
          }))
        }
      />
    </Grid>
  );

  const submit = () => {
    save.mutate({ ...(profile ? { id: profile.id } : {}), body: form }, { onSuccess: onClose });
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="profile-title">
      <DialogTitle id="profile-title">
        {profile ? 'Edit invoice profile' : 'New invoice profile'}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ pt: 1 }}>
          {text('name', 'Profile name', { required: true })}
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.enabled}
                  onChange={(_, v) => setForm((f) => ({ ...f, enabled: v }))}
                />
              }
              label="Enabled"
            />
          </Grid>
          <Grid size={12}>
            <Typography variant="subtitle2">Client</Typography>
          </Grid>
          {text('client_name', 'Client name', { required: true })}
          {text('client_cif', 'Client CIF')}
          {text('client_rc', 'Trade register no.')}
          {text('client_email', 'Client email')}
          {text('client_address', 'Address', { md: 12 })}
          {text('client_city', 'City', { md: 4 })}
          {text('client_state', 'County', { md: 4 })}
          {text('client_country', 'Country', { md: 4 })}
          <Grid size={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.client_vat_payer}
                  onChange={(_, v) => setForm((f) => ({ ...f, client_vat_payer: v }))}
                />
              }
              label="Client is a VAT payer"
            />
          </Grid>
          <Grid size={12}>
            <Typography variant="subtitle2">
              Invoice line and taxes (as configured in Oblio)
            </Typography>
          </Grid>
          {text('series_name', 'Oblio series', { required: true, md: 4 })}
          {text('currency', 'Currency', { required: true, md: 4 })}
          {text('measuring_unit', 'Unit', { md: 4 })}
          {text('description', 'Description', {
            required: true,
            md: 12,
            helper: 'Placeholders: {period}, {month_name}, {year}',
          })}
          {text('unit_price', 'Unit price', { required: true, md: 4 })}
          {text('quantity', 'Quantity', { required: true, md: 4 })}
          <Grid size={{ xs: 12, md: 4 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.vat_included}
                  onChange={(_, v) => setForm((f) => ({ ...f, vat_included: v }))}
                />
              }
              label="Price includes VAT"
            />
          </Grid>
          {text('vat_name', 'VAT name (Oblio)', { helper: 'Leave empty to use Oblio defaults' })}
          {text('vat_percentage', 'VAT %', { helper: 'Explicit rate; never assumed' })}
          <Grid size={12}>
            <Typography variant="subtitle2">Dates and delivery</Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              label="Billing period"
              value={form.billing_period}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  billing_period: e.target.value as InvoiceProfileInput['billing_period'],
                }))
              }
            >
              <MenuItem value="previous_month">Previous month</MenuItem>
              <MenuItem value="current_month">Current month</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              type="number"
              label="Due in days"
              value={form.due_days}
              onChange={(e) => setForm((f) => ({ ...f, due_days: Number(e.target.value) }))}
              slotProps={{ htmlInput: { min: 0, max: 365 } }}
            />
          </Grid>
          {text('timezone', 'Timezone', { md: 4 })}
          {text('mentions', 'Mentions on invoice', { md: 12 })}
          <Grid size={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.send_email}
                  onChange={(_, v) => setForm((f) => ({ ...f, send_email: v }))}
                />
              }
              label="Let Oblio email the invoice to the client"
            />
          </Grid>
          {save.isError && (
            <Grid size={12}>
              <Alert severity="error">{errorMessage(save.error)}</Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} loading={save.isPending}>
          Save profile
        </Button>
      </DialogActions>
    </Dialog>
  );
}
