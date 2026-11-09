import { Bell, Plus, ShoppingBag, Store, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  useDismissAlert,
  usePriceAlerts,
  useProducts,
  type PriceAlert,
  type Product,
  type ProductStatus,
} from '@/api/shopping';
import { formatMoney, relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Panel } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { cn } from '@/lib/cn';

import { MerchantsDialog, ProductDialog } from './Dialogs';
import { ProductPanel } from './ProductPanel';

const FILTERS: { value: ProductStatus; label: string }[] = [
  { value: 'watching', label: 'Watching' },
  { value: 'approved', label: 'Decided' },
  { value: 'purchased', label: 'Purchased' },
  { value: 'archived', label: 'Archived' },
];

const ALERT_TEXT: Record<PriceAlert['kind'], string> = {
  below_target: 'below your target',
  price_drop: 'price dropped',
  back_in_stock: 'back in stock',
};

function ProductCard({ product, onOpen }: { product: Product; onOpen: () => void }) {
  const best = product.best;
  const target = product.target_price;
  const atTarget = Boolean(target && best && Number(best.price) <= Number(target));
  const gap = target && best && !atTarget ? Number(best.price) - Number(target) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass flex w-full flex-col gap-3 rounded-lg p-4 text-left transition-[border-color,box-shadow] hover:border-electric/50 hover:shadow-glow"
    >
      <div className="flex w-full items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-violet/40 bg-violet/10 text-violet">
          <ShoppingBag className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold text-ink">{product.name}</p>
          <p className="truncate text-xs text-ink-dim">
            {[product.brand, product.model].filter(Boolean).join(' ') || product.category || '—'}
          </p>
        </div>
        {product.open_alerts > 0 && (
          <Badge tone="info" dot>
            {product.open_alerts}
          </Badge>
        )}
      </div>
      <div className="flex w-full items-end justify-between gap-3">
        <div>
          <p className="label-caps">Best price</p>
          <p
            className={cn('font-mono text-lg tabular-nums', atTarget ? 'text-success' : 'text-ink')}
          >
            {best ? formatMoney(best.price, best.currency) : '—'}
          </p>
          <p className="text-xs text-ink-dim">
            {best ? `${best.merchant} · ${relativeTime(best.observed_at)}` : 'No price recorded'}
          </p>
        </div>
        <div className="text-right">
          {target && (
            <p className="text-xs text-ink-muted">
              target {formatMoney(target, product.currency)}
              {gap !== null && gap > 0 && (
                <span className="block text-ink-dim">
                  {formatMoney(gap.toFixed(2), product.currency)} to go
                </span>
              )}
            </p>
          )}
          <p className="mt-1 text-xs text-ink-dim">
            {product.listing_count} merchant{product.listing_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {product.status !== 'watching' && <StatusChip status={product.status} />}
    </button>
  );
}

export function ShoppingPage() {
  const workspace = useCurrentWorkspace();
  const workspaceId = workspace?.id;
  const [status, setStatus] = useState<ProductStatus>('watching');
  const products = useProducts(workspaceId, status);
  const alerts = usePriceAlerts(workspaceId);
  const dismiss = useDismissAlert(workspaceId);
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [merchantsOpen, setMerchantsOpen] = useState(false);
  const openId = params.get('product');
  const canEdit = workspace?.role !== undefined && workspace.role !== 'viewer';

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('product', id);
    else next.delete('product');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Domains"
        title="Shopping Intelligence"
        subtitle="Track products across merchants, see price history and get alerted at your target price. Prices are recorded by you — nothing is scraped and nothing is ever ordered."
        actions={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => setMerchantsOpen(true)}>
                <Store /> Merchants
              </Button>
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus /> Track product
              </Button>
            </>
          )
        }
      />

      {(alerts.data ?? []).length > 0 && (
        <Panel title="Price alerts" icon={<Bell />}>
          <ul className="divide-y divide-line" aria-label="Open price alerts">
            {(alerts.data ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:underline"
                  onClick={() => open(a.product_id)}
                >
                  <span className="font-medium">{a.product_name}</span>{' '}
                  <span className="text-ink-muted">{ALERT_TEXT[a.kind]}</span>
                </button>
                <span className="font-mono text-sm tabular-nums">
                  {formatMoney(a.price, a.currency)}
                  {a.previous_price && a.kind !== 'below_target' && (
                    <span className="ml-1.5 text-xs text-ink-dim line-through">
                      {formatMoney(a.previous_price, a.currency)}
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-dim">{relativeTime(a.created_at)}</span>
                {canEdit && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Dismiss alert for ${a.product_name}`}
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(a.id)}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Tabs value={status} onValueChange={(v) => setStatus(v as ProductStatus)}>
        <TabsList aria-label="Product status">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {!workspaceId ? (
        <EmptyState title="No workspace selected" />
      ) : products.isPending ? (
        <LoadingState />
      ) : products.isError ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : products.data.length === 0 ? (
        <Panel>
          <EmptyState
            title={status === 'watching' ? 'No products tracked yet' : 'Nothing here'}
            description={
              status === 'watching'
                ? 'Track a product, add the merchants that sell it, and record prices as you see them.'
                : undefined
            }
            action={
              canEdit && status === 'watching' ? (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <Plus /> Track product
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Products">
          {products.data.map((p) => (
            <li key={p.id} className="flex">
              <ProductCard product={p} onOpen={() => open(p.id)} />
            </li>
          ))}
        </ul>
      )}

      {workspaceId && adding && (
        <ProductDialog
          workspaceId={workspaceId}
          onClose={() => setAdding(false)}
          onSaved={(p) => open(p.id)}
        />
      )}
      {workspaceId && merchantsOpen && (
        <MerchantsDialog workspaceId={workspaceId} onClose={() => setMerchantsOpen(false)} />
      )}
      {workspaceId && openId && (
        <ProductPanel
          workspaceId={workspaceId}
          productId={openId}
          canEdit={canEdit}
          onClose={() => open(null)}
        />
      )}
    </div>
  );
}

export default ShoppingPage;
