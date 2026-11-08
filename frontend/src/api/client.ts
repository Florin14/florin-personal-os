import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './schema';

export const CSRF_COOKIE = 'pos_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) return decodeURIComponent(cookie.slice(prefix.length));
  }
  return null;
}

/** Echoes the session's CSRF token on state-changing requests (see ADR-003). */
const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (UNSAFE_METHODS.has(request.method)) {
      const token = readCookie(CSRF_COOKIE);
      if (token) request.headers.set(CSRF_HEADER, token);
    }
    return request;
  },
};

/** Typed API client generated from the backend OpenAPI schema. Same-origin only. */
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: 'same-origin',
  // Resolve fetch lazily so tests can replace the global.
  fetch: (request) => globalThis.fetch(request),
});
api.use(csrfMiddleware);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export function toApiError(status: number, body: unknown): ApiError {
  const envelope = (typeof body === 'object' && body !== null ? body : {}) as ErrorEnvelope;
  return new ApiError(
    status,
    envelope.error?.code ?? 'unknown_error',
    envelope.error?.message ?? 'The request failed.',
  );
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Resolves with the response body or throws an ApiError (status 0 = network failure). */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await request;
  } catch {
    throw new ApiError(0, 'network_error', 'Unable to reach the server.');
  }
  if (result.error !== undefined || !result.response.ok) {
    throw toApiError(result.response.status, result.error);
  }
  return result.data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong.';
}
