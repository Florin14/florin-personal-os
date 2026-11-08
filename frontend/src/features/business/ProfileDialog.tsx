import { useState } from 'react';

import { errorMessage } from '@/api/client';
import { useSaveInvoiceProfile, type InvoiceProfile, type InvoiceProfileInput } from '@/api/invoicing';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, SwitchField } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';

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
  | 'name' | 'client_name' | 'client_cif' | 'client_rc' | 'client_address' | 'client_city'
  | 'client_state' | 'client_country' | 'client_email' | 'series_name' | 'currency' | 'description'
  | 'measuring_unit' | 'unit_price' | 'quantity' | 'vat_name' | 'vat_percentage' | 'timezone' | 'mentions';

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
  const [form, setForm] = useState<InvoiceProfileInput>(() => (profile ? fromProfile(profile) : EMPTY));
  const set = <K extends keyof InvoiceProfileInput>(key: K, value: InvoiceProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const text = (key: TextKey, label: string, opts: { required?: boolean; help?: string; wide?: boolean } = {}) => (
    <Field label={label} required={opts.required} help={opts.help} className={opts.wide ? 'sm:col-span-2' : ''}>
      {(p) => (
        <Input
          {...p}
          value={String(form[key] ?? '')}
          required={opts.required}
          onChange={(e) => set(key, (e.target.value === '' && !opts.required ? null : e.target.value) as never)}
        />
      )}
    </Field>
  );

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={profile ? 'Edit invoice profile' : 'New invoice profile'}
      description="Every fiscal setting is explicit — nothing is inferred or fabricated."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => save.mutate({ ...(profile ? { id: profile.id } : {}), body: form }, { onSuccess: onClose })}
          >
            Save profile
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {text('name', 'Profile name', { required: true })}
        <div className="flex items-end pb-2">
          <SwitchField label="Enabled" checked={form.enabled ?? true} onCheckedChange={(v) => set('enabled', v)} />
        </div>
        <p className="label-caps pt-2 sm:col-span-2">Client</p>
        {text('client_name', 'Client name', { required: true })}
        {text('client_cif', 'Client CIF')}
        {text('client_rc', 'Trade register no.')}
        {text('client_email', 'Client email')}
        {text('client_address', 'Address', { wide: true })}
        {text('client_city', 'City')}
        {text('client_state', 'County')}
        {text('client_country', 'Country')}
        <div className="flex items-end pb-2">
          <SwitchField label="Client is a VAT payer" checked={form.client_vat_payer ?? false} onCheckedChange={(v) => set('client_vat_payer', v)} />
        </div>
        <p className="label-caps pt-2 sm:col-span-2">Invoice line & taxes (as configured in Oblio)</p>
        {text('series_name', 'Oblio series', { required: true })}
        {text('currency', 'Currency', { required: true })}
        {text('description', 'Description', { required: true, wide: true, help: 'Placeholders: {period}, {month_name}, {year}' })}
        {text('unit_price', 'Unit price', { required: true })}
        {text('quantity', 'Quantity', { required: true })}
        {text('measuring_unit', 'Unit')}
        <div className="flex items-end pb-2">
          <SwitchField label="Price includes VAT" checked={form.vat_included ?? false} onCheckedChange={(v) => set('vat_included', v)} />
        </div>
        {text('vat_name', 'VAT name (Oblio)', { help: 'Empty = Oblio defaults' })}
        {text('vat_percentage', 'VAT %', { help: 'Explicit rate; never assumed' })}
        <p className="label-caps pt-2 sm:col-span-2">Dates & delivery</p>
        <Field label="Billing period">
          {(p) => (
            <Select {...p} value={form.billing_period ?? 'previous_month'} onChange={(e) => set('billing_period', e.target.value as InvoiceProfileInput['billing_period'])}>
              <option value="previous_month">Previous month</option>
              <option value="current_month">Current month</option>
            </Select>
          )}
        </Field>
        <Field label="Due in days">
          {(p) => <Input {...p} type="number" min={0} max={365} value={form.due_days ?? 15} onChange={(e) => set('due_days', Number(e.target.value))} />}
        </Field>
        {text('timezone', 'Timezone')}
        {text('mentions', 'Mentions on invoice', { wide: true })}
        <div className="sm:col-span-2">
          <SwitchField label="Let Oblio email the invoice to the client" checked={form.send_email ?? false} onCheckedChange={(v) => set('send_email', v)} />
        </div>
        {save.isError && <Alert tone="danger" className="sm:col-span-2">{errorMessage(save.error)}</Alert>}
      </div>
    </Modal>
  );
}
