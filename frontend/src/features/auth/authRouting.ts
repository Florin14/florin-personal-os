import type { AuthState } from '@/api/types';

export const ROUTES = {
  login: '/login',
  mfaVerify: '/login/mfa',
  mfaEnroll: '/setup/mfa',
  home: '/',
} as const;

/** Where a user in the given authentication state belongs. */
export function routeForAuthState(state: AuthState | null | undefined): string {
  if (!state) return ROUTES.login;
  switch (state.next_step) {
    case 'mfa_verify':
      return ROUTES.mfaVerify;
    case 'mfa_enroll':
      return ROUTES.mfaEnroll;
    default:
      return ROUTES.home;
  }
}
