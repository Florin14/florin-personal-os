import {
  Archive,
  CheckCircle2,
  ExternalLink,
  Eye,
  Pencil,
  Plus,
  ShoppingCart,
  Tag,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import {
  useAddListing,
  useDeleteListing,
  useDeleteProduct,
  useMerchants,
  useProductDetail,
  useSetProductStatus,
  type Listing,
  type ProductStatus,
} from '@/api/shopping';
import { formatMoney, relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Badge, Table, Td, Th, Tr } from '@/components/ui/surface';

import { ProductDialog, RecordPriceDialog } from './Dialogs';
import { PriceHistoryChart } from './PriceHistoryChart';
import { seriesFor } from './series';

const ALERT_TEXT = {
  below_target: 'Below target',
  price_drop: 'Price drop',
  back_in_stock: 'Back in stock',
} as const;

function StockBadge({ inStock }: { inStock: boolean | null | undefined }) {
  if (inStock === true) return <Badge tone="success">in stock</Badge>;
  if (inStock === false) return <Badge tone="neutral">out of stock</Badge>;
  return <span className="text-xs text-ink-dim">—</span>;
}

/** Decision to buy (no checkout) or a purchase made elsewhere, with the price it happened at. */
function DecisionDialog({
  status,
  suggestedPrice,
  currency,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  status: 'approved' | 'purchased';
  suggestedPrice: string;
  currency: string;
  pending: boolean;
  error: unknown;
  onConfirm: (price: string | null) => void;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(suggestedPrice);
  const valid = price === '' || /^\d+(\.\d{1,2})?$/.test(price);
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => !open && onClose()}
      title={status === 'approved' ? 'Record decision to buy' : 'Mark as purchased'}
      description={
        status === 'approved'
          ? 'Stops alerts for this product. Nothing is ordered — you buy it yourself.'
          : 'Records the purchase you made at the merchant. Personal OS never places orders.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={pending}
            onClick={() => onConfirm(price || null)}
          >
            Confirm
          </Button>
        </>
      }
    >
      <Field label={`Price (${currency})`} help="Optional.">
        {(p) => (
          <Input
            {...p}
            value={price}
            inputMode="decimal"
            onChange={(e) => setPrice(e.target.value.replace(',', '.'))}
          />
        )}
      </Field>
      {error ? (
        <Alert tone="danger" className="mt-3">
          {errorMessage(error)}
        </Alert>
      ) : null}
    </Modal>
  );
}

export function ProductPanel({
  workspaceId,
  productId,
  canEdit,
  onClose,
}: {
  workspaceId: string;
  productId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const detail = useProductDetail(workspaceId, productId);
  const merchants = useMerchants(workspaceId);
  const addListing = useAddListing(workspaceId);
  const removeListing = useDeleteListing(workspaceId);
  const setStatus = useSetProductStatus(workspaceId);
  const removeProduct = useDeleteProduct(workspaceId);
  const [recordFor, setRecordFor] = useState<Listing | null>(null);
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<'approved' | 'purchased' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [merchantId, setMerchantId] = useState('');
  const [url, setUrl] = useState('');

  const data = detail.data;
  const product = data?.product;
  const listings = data?.listings ?? [];
  const history = data?.history ?? [];
  const productAlerts = data?.alerts ?? [];
  const colors = new Map(seriesFor(listings).map((s) => [s.listingId, s.color]));
  const listed = new Set(listings.map((l) => l.merchant.id));
  const available = (merchants.data ?? []).filter((m) => !listed.has(m.id));
  const error = addListing.error ?? removeListing.error ?? removeProduct.error;

  const changeStatus = (status: ProductStatus, price: string | null = null) =>
    setStatus.mutate({ id: productId, status, price }, { onSuccess: () => setDeciding(null) });

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(open) => !open && onClose()}
      title={product?.name ?? 'Product'}
      description={
        product
          ? [product.brand, product.model, product.gtin && `GTIN ${product.gtin}`, product.category]
              .filter(Boolean)
              .join(' · ') || undefined
          : undefined
      }
    >
      {detail.isPending ? (
        <LoadingState compact />
      ) : detail.isError ? (
        <ErrorState compact error={detail.error} onRetry={() => void detail.refetch()} />
      ) : product ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={product.status} />
            {product.target_price && (
              <Badge tone="info">
                target {formatMoney(product.target_price, product.currency)}
              </Badge>
            )}
            {product.best && (
              <Badge tone="electric">
                best {formatMoney(product.best.price, product.best.currency)} ·{' '}
                {product.best.merchant}
              </Badge>
            )}
            {product.decided_price && (
              <Badge tone="success">
                decided at {formatMoney(product.decided_price, product.currency)}
              </Badge>
            )}
            <span className="flex-1" />
            {canEdit && (
              <div className="flex flex-wrap gap-1.5">
                {product.status === 'watching' && (
                  <Button size="sm" variant="success" onClick={() => setDeciding('approved')}>
                    <CheckCircle2 /> Decide to buy
                  </Button>
                )}
                {(product.status === 'watching' || product.status === 'approved') && (
                  <Button size="sm" variant="secondary" onClick={() => setDeciding('purchased')}>
                    <ShoppingCart /> Mark purchased
                  </Button>
                )}
                {product.status !== 'watching' && (
                  <Button size="sm" variant="ghost" onClick={() => changeStatus('watching')}>
                    <Eye /> Watch again
                  </Button>
                )}
                {product.status === 'watching' && (
                  <Button size="sm" variant="ghost" onClick={() => changeStatus('archived')}>
                    <Archive /> Archive
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit product"
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete product"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>

          {error && <Alert tone="danger">{errorMessage(error)}</Alert>}

          <section aria-label="Merchant comparison" className="space-y-2">
            <p className="label-caps">Merchant comparison</p>
            {listings.length === 0 ? (
              <p className="text-sm text-ink-dim">
                Add a merchant that sells this product to start tracking prices.
              </p>
            ) : (
              <Table aria-label="Merchant comparison">
                <thead>
                  <tr>
                    <Th>Merchant</Th>
                    <Th className="text-right">Latest</Th>
                    <Th>Stock</Th>
                    <Th className="text-right">Lowest seen</Th>
                    <Th className="sr-only">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => {
                    const target = product.target_price;
                    const below =
                      target && l.latest && l.latest.currency === product.currency
                        ? Number(l.latest.price) <= Number(target)
                        : false;
                    return (
                      <Tr key={l.id}>
                        <Td>
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <span
                              className="h-0.5 w-3 rounded-full"
                              style={{ background: colors.get(l.id) ?? 'transparent' }}
                              aria-hidden
                            />
                            {l.merchant.name}
                            {l.url && (
                              <a
                                href={l.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="text-ink-dim hover:text-ink"
                                aria-label={`Open listing at ${l.merchant.name}`}
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                          </span>
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          <span className="font-mono tabular-nums">
                            {l.latest ? formatMoney(l.latest.price, l.latest.currency) : '—'}
                          </span>
                          {below && (
                            <Badge tone="success" className="ml-2">
                              ≤ target
                            </Badge>
                          )}
                          <span className="block text-xs text-ink-dim">
                            {l.latest ? relativeTime(l.latest.observed_at) : 'no price yet'}
                          </span>
                        </Td>
                        <Td>
                          <StockBadge inStock={l.latest?.in_stock} />
                        </Td>
                        <Td className="text-right font-mono whitespace-nowrap text-ink-muted tabular-nums">
                          {l.lowest_price ? formatMoney(l.lowest_price, product.currency) : '—'}
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          {canEdit && (
                            <>
                              <Button
                                size="icon-sm"
                                variant="secondary"
                                aria-label={`Record price at ${l.merchant.name}`}
                                title="Record price"
                                onClick={() => setRecordFor(l)}
                              >
                                <Tag />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove ${l.merchant.name}`}
                                onClick={() => removeListing.mutate(l.id)}
                              >
                                <Trash2 />
                              </Button>
                            </>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            {canEdit && (
              <form
                className="flex flex-wrap items-end gap-2 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  addListing.mutate(
                    { productId, merchantId, url: url.trim() || null },
                    {
                      onSuccess: () => {
                        setMerchantId('');
                        setUrl('');
                      },
                    },
                  );
                }}
              >
                <Field label="Add merchant" className="min-w-40">
                  {(p) => (
                    <Select
                      {...p}
                      value={merchantId}
                      onChange={(e) => setMerchantId(e.target.value)}
                    >
                      <option value="">
                        {available.length
                          ? 'Choose…'
                          : (merchants.data ?? []).length
                            ? 'All merchants listed'
                            : 'Add merchants first'}
                      </option>
                      {available.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Product link (optional)" className="min-w-56 flex-1">
                  {(p) => (
                    <Input
                      {...p}
                      value={url}
                      placeholder="https://"
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!merchantId}
                  loading={addListing.isPending}
                >
                  <Plus /> Add
                </Button>
              </form>
            )}
          </section>

          <section aria-label="Price history" className="space-y-2">
            <p className="label-caps">Price history</p>
            <PriceHistoryChart
              history={history}
              listings={listings}
              currency={product.currency}
              target={product.target_price ?? null}
            />
          </section>

          {productAlerts.length > 0 && (
            <section aria-label="Alerts" className="space-y-2">
              <p className="label-caps">Alerts</p>
              <ul className="space-y-1 text-sm">
                {productAlerts.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Badge tone={a.status === 'open' ? 'info' : 'neutral'}>
                      {ALERT_TEXT[a.kind]}
                    </Badge>
                    <span className="font-mono tabular-nums">
                      {formatMoney(a.price, a.currency)}
                    </span>
                    <span className="text-xs text-ink-dim">{relativeTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {recordFor && (
            <RecordPriceDialog
              workspaceId={workspaceId}
              listing={recordFor}
              product={product}
              onClose={() => setRecordFor(null)}
            />
          )}
          {editing && (
            <ProductDialog
              workspaceId={workspaceId}
              product={product}
              onClose={() => setEditing(false)}
            />
          )}
          {deciding && (
            <DecisionDialog
              status={deciding}
              suggestedPrice={product.best?.price ?? ''}
              currency={product.currency}
              pending={setStatus.isPending}
              error={setStatus.error}
              onConfirm={(price) => changeStatus(deciding, price)}
              onClose={() => setDeciding(null)}
            />
          )}
          {confirmDelete && (
            <Modal
              open
              size="sm"
              onOpenChange={(open) => !open && setConfirmDelete(false)}
              title="Stop tracking and delete?"
              description="Deletes the product with its listings, price history and alerts. Archive keeps the history instead."
              footer={
                <>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    loading={removeProduct.isPending}
                    onClick={() => removeProduct.mutate(productId, { onSuccess: onClose })}
                  >
                    Delete
                  </Button>
                </>
              }
            >
              <p className="text-sm text-ink-muted">This is recorded in the audit log.</p>
            </Modal>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
