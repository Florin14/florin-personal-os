export const queryKeys = {
  auth: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  health: ['system', 'health'] as const,
  systemInfo: ['system', 'info'] as const,
  workspaces: ['workspaces'] as const,
};
