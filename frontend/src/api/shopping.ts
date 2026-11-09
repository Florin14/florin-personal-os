/** Hooks for shopping & price tracking (Phase 5, ADR-022). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import type { components } from './schema';

type S = components['schemas'];
export type Merchant = S['MerchantOut'];
export type MerchantInput = S['MerchantIn'];
export type Product = S['ProductOut'];
export type ProductInput = S['ProductIn'];
export type ProductDetail = S['ProductDetailOut'];
export type Listing = S['ListingOut'];
export type Observation = S['ObservationOut'];
export type ObservationInput = S['ObservationIn'];
export type PriceAlert = S['AlertOut'];
export type ProductStatus = Product['status'];

const ROOT = ['shopping'] as const;
const ws = (workspaceId: string | undefined) => ({ workspace_id: workspaceId ?? '' });

function useInvalidateShopping() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ROOT });
}

export function useMerchants(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'merchants'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/shopping/merchants', {
          params: { path: ws(workspaceId) },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveMerchant(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: MerchantInput }) =>
      id
        ? unwrap(
            api.PUT('/api/v1/workspaces/{workspace_id}/shopping/merchants/{merchant_id}', {
              params: { path: { ...ws(workspaceId), merchant_id: id } },
              body,
            }),
          )
        : unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/shopping/merchants', {
              params: { path: ws(workspaceId) },
              body,
            }),
          ),
    onSuccess: invalidate,
  });
}

export function useDeleteMerchant(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/shopping/merchants/{merchant_id}', {
          params: { path: { ...ws(workspaceId), merchant_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useProducts(workspaceId: string | undefined, status?: ProductStatus) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'products', status ?? 'all'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/shopping/products', {
          params: { path: ws(workspaceId), query: status ? { status } : {} },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useProductDetail(workspaceId: string | undefined, productId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'product', productId],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/shopping/products/{product_id}', {
          params: { path: { ...ws(workspaceId), product_id: productId ?? '' } },
        }),
      ),
    enabled: Boolean(workspaceId && productId),
  });
}

export function useSaveProduct(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ProductInput }) =>
      id
        ? unwrap(
            api.PUT('/api/v1/workspaces/{workspace_id}/shopping/products/{product_id}', {
              params: { path: { ...ws(workspaceId), product_id: id } },
              body,
            }),
          )
        : unwrap(
            api.POST('/api/v1/workspaces/{workspace_id}/shopping/products', {
              params: { path: ws(workspaceId) },
              body,
            }),
          ),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/shopping/products/{product_id}', {
          params: { path: { ...ws(workspaceId), product_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Records a purchase decision or a purchase made elsewhere; nothing is ever ordered. */
export function useSetProductStatus(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: ({
      id,
      status,
      price,
    }: {
      id: string;
      status: ProductStatus;
      price?: string | null;
    }) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{workspace_id}/shopping/products/{product_id}/status', {
          params: { path: { ...ws(workspaceId), product_id: id } },
          body: { status, price: price ?? null },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useAddListing(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: ({
      productId,
      merchantId,
      url,
    }: {
      productId: string;
      merchantId: string;
      url: string | null;
    }) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/shopping/products/{product_id}/listings', {
          params: { path: { ...ws(workspaceId), product_id: productId } },
          body: { merchant_id: merchantId, url },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteListing(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/shopping/listings/{listing_id}', {
          params: { path: { ...ws(workspaceId), listing_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useRecordPrice(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: ({ listingId, body }: { listingId: string; body: ObservationInput }) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/shopping/listings/{listing_id}/observations', {
          params: { path: { ...ws(workspaceId), listing_id: listingId } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteObservation(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/shopping/observations/{observation_id}', {
          params: { path: { ...ws(workspaceId), observation_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function usePriceAlerts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, workspaceId, 'alerts'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/shopping/alerts', {
          params: { path: ws(workspaceId), query: { status: 'open' } },
        }),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useDismissAlert(workspaceId: string | undefined) {
  const invalidate = useInvalidateShopping();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspace_id}/shopping/alerts/{alert_id}/dismiss', {
          params: { path: { ...ws(workspaceId), alert_id: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}
