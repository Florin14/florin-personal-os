import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError, unwrap } from './client';
import { queryKeys } from './queryKeys';
import type { AuthState } from './types';

/** Current authentication state; `null` means signed out. */
export function useAuthState() {
  return useQuery({
    queryKey: queryKeys.auth,
    queryFn: async (): Promise<AuthState | null> => {
      try {
        return await unwrap(api.GET('/api/v1/auth/me'));
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthenticated) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}

function useSetAuthState() {
  const queryClient = useQueryClient();
  return (state: AuthState | null) => {
    queryClient.setQueryData(queryKeys.auth, state);
  };
}

export function useLogin() {
  const setAuth = useSetAuthState();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      unwrap(api.POST('/api/v1/auth/login', { body })),
    onSuccess: setAuth,
  });
}

export function useVerifyMfa() {
  const setAuth = useSetAuthState();
  return useMutation({
    mutationFn: (code: string) => unwrap(api.POST('/api/v1/auth/mfa/verify', { body: { code } })),
    onSuccess: setAuth,
  });
}

export function useBeginTotpEnrollment() {
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/auth/mfa/totp/setup')),
  });
}

export function useConfirmTotpEnrollment() {
  const setAuth = useSetAuthState();
  return useMutation({
    mutationFn: (code: string) =>
      unwrap(api.POST('/api/v1/auth/mfa/totp/confirm', { body: { code } })),
    onSuccess: setAuth,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/auth/logout')),
    onSettled: () => {
      // Drop every cached server response belonging to the previous session.
      queryClient.clear();
      queryClient.setQueryData(queryKeys.auth, null);
    },
  });
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => unwrap(api.GET('/api/v1/auth/sessions')),
    enabled,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      unwrap(
        api.DELETE('/api/v1/auth/sessions/{session_id}', {
          params: { path: { session_id: sessionId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      unwrap(api.POST('/api/v1/auth/password', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}
