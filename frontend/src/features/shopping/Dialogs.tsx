import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import {
  useDeleteMerchant,
  useMerchants,
  useRecordPrice,
  useSaveMerchant,
  useSaveProduct,
  type Listing,
  type Product,
  type ProductInput,
} from '@/api/shopping';
import { formatMoney } from '@/components/data/format';
import { LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';

const MONEY = /^\d+(\.\d{1,2})?$/;

/** Create or edit a tracked product (canonical identity: GTIN > brand+model > name). */
export function ProductDialog({
  workspaceId,
  product,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  product?: Product;
  onClose: () => void;
  onSaved?: (product: Product) => void;
}) {
  const save = useSaveProduct(workspaceId);
  const [form, setForm] = useState({
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    model: product?.model ?? '',
    gtin: product?.gtin ?? '',
    category: product?.category ?? '',
    target_price: product?.target_price ?? '',
    currency: product?.currency ?? 'RON',
    drop_alert_percent: product?.drop_alert_percent ?? '5',
    notes: product?.notes ?? '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  const targetError =
    form.target_price && !MONEY.test(form.target_price) ? 'Use a number like 2999.99' : null;
  const valid =
    form.name.trim() && !targetError && /^[A-Z]{3}$/.test(form.currency) && form.drop_alert_percent;

  const submit = () => {
    const body: ProductInput = {
      ...form,
      gtin: form.gtin.trim() || null,
      target_price: form.target_price || null,
    };
    save.mutate(
      { ...(product ? { id: product.id } : {}), body },
      {
        onSuccess: (saved) => {
          onSaved?.(saved);
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={product ? 'Edit product' : 'Track a product'}
      description="The same GTIN, or the same brand and model, can only be tracked once."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!valid}>
            {product ? 'Save' : 'Track product'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={form.name}
              maxLength={200}
              onChange={(e) => set('name')(e.target.value)}
            />
          )}
        </Field>
        <Field label="Brand">
          {(p) => (
            <Input
              {...p}
              value={form.brand}
              maxLength={100}
              onChange={(e) => set('brand')(e.target.value)}
            />
          )}
        </Field>
        <Field label="Model">
          {(p) => (
            <Input
              {...p}
              value={form.model}
              maxLength={100}
              onChange={(e) => set('model')(e.target.value)}
            />
          )}
        </Field>
        <Field label="GTIN / EAN" help="8, 12, 13 or 14 digits (check digit verified).">
          {(p) => (
            <Input
              {...p}
              value={form.gtin}
              maxLength={14}
              inputMode="numeric"
              className="font-mono"
              onChange={(e) => set('gtin')(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Field label="Category">
          {(p) => (
            <Input
              {...p}
              value={form.category}
              maxLength={50}
              onChange={(e) => set('category')(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Buy below (target price)"
          error={targetError}
          help="Alerts when a price reaches it."
        >
          {(p) => (
            <Input
              {...p}
              value={form.target_price}
              inputMode="decimal"
              placeholder="e.g. 2999.99"
              onChange={(e) => set('target_price')(e.target.value.replace(',', '.'))}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency" required>
            {(p) => (
              <Input
                {...p}
                value={form.currency}
                maxLength={3}
                className="font-mono uppercase"
                onChange={(e) => set('currency')(e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label="Drop alert %">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0.5}
                max={90}
                step={0.5}
                value={form.drop_alert_percent}
                onChange={(e) => set('drop_alert_percent')(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          {(p) => (
            <Textarea {...p} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
          )}
        </Field>
      </div>
      {save.isError && (
        <Alert tone="danger" className="mt-3">
          {errorMessage(save.error)}
        </Alert>
      )}
    </Modal>
  );
}

/** Merchants are shared by all products of the workspace. */
export function MerchantsDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const merchants = useMerchants(workspaceId);
  const save = useSaveMerchant(workspaceId);
  const remove = useDeleteMerchant(workspaceId);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const error = save.error ?? remove.error;
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Merchants"
      description="Shops you compare prices at. Links are only shown to you — Personal OS never visits them."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { body: { name: name.trim(), website: website.trim() || null } },
            {
              onSuccess: () => {
                setName('');
                setWebsite('');
              },
            },
          );
        }}
      >
        <Field label="Name" className="min-w-36 flex-1">
          {(p) => (
            <Input {...p} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="Website (optional)" className="min-w-48 flex-1">
          {(p) => (
            <Input
              {...p}
              value={website}
              placeholder="https://"
              onChange={(e) => setWebsite(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={!name.trim()} loading={save.isPending}>
          <Plus /> Add
        </Button>
      </form>
      {error && (
        <Alert tone="danger" className="mt-3">
          {errorMessage(error)}
        </Alert>
      )}
      <div className="mt-4">
        {merchants.isPending ? (
          <LoadingState compact />
        ) : (merchants.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-dim">No merchants yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line" aria-label="Merchants">
            {(merchants.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 truncate">{m.name}</span>
                {m.website && (
                  <a
                    href={m.website}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-ink-dim hover:text-ink"
                    aria-label={`Open ${m.name} website`}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${m.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(m.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Records a price you saw (in a shop, an email, a website you visited yourself). */
export function RecordPriceDialog({
  workspaceId,
  listing,
  product,
  onClose,
}: {
  workspaceId: string;
  listing: Listing;
  product: Product;
  onClose: () => void;
}) {
  const record = useRecordPrice(workspaceId);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [note, setNote] = useState('');
  const valid = MONEY.test(price) && Number(price) > 0;
  const alerts = record.data?.alerts ?? [];
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => !open && onClose()}
      title={`Price at ${listing.merchant.name}`}
      description={product.name}
      footer={
        record.data ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!valid}
              loading={record.isPending}
              onClick={() =>
                record.mutate({
                  listingId: listing.id,
                  body: {
                    price,
                    in_stock: stock === 'unknown' ? null : stock === 'yes',
                    note,
                  },
                })
              }
            >
              Record price
            </Button>
          </>
        )
      }
    >
      {record.data ? (
        <div className="space-y-2">
          <Alert tone="success">
            Recorded {formatMoney(record.data.observation.price, record.data.observation.currency)}.
          </Alert>
          {alerts.map((a) => (
            <Alert key={a.id} tone="info">
              {a.kind === 'below_target'
                ? 'At or below your target price — an alert was sent.'
                : a.kind === 'price_drop'
                  ? `Price dropped from ${formatMoney(a.previous_price ?? '0', a.currency)}.`
                  : 'Back in stock.'}
            </Alert>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={`Price (${product.currency})`} required>
            {(p) => (
              <Input
                {...p}
                value={price}
                inputMode="decimal"
                placeholder="e.g. 2949.99"
                onChange={(e) => setPrice(e.target.value.replace(',', '.'))}
              />
            )}
          </Field>
          <Field label="In stock">
            {(p) => (
              <Select
                {...p}
                value={stock}
                onChange={(e) => setStock(e.target.value as typeof stock)}
              >
                <option value="unknown">Not sure</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            )}
          </Field>
          <Field label="Note">
            {(p) => (
              <Input
                {...p}
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {record.isError && <Alert tone="danger">{errorMessage(record.error)}</Alert>}
        </div>
      )}
    </Modal>
  );
}
