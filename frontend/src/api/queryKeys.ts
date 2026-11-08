export const queryKeys = {
  auth: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  health: ['system', 'health'] as const,
  systemInfo: ['system', 'info'] as const,
  workspaces: ['workspaces'] as const,
  approvals: (status?: string) => ['approvals', 'list', status ?? 'all'] as const,
  approval: (id: string) => ['approvals', 'detail', id] as const,
  approvalsRoot: ['approvals'] as const,
  notifications: ['notifications', 'list'] as const,
  unreadCount: ['notifications', 'unread'] as const,
  notificationsRoot: ['notifications'] as const,
  audit: (prefix?: string) => ['audit', prefix ?? ''] as const,
  jobs: (status?: string) => ['jobs', 'list', status ?? 'all'] as const,
  jobStats: ['jobs', 'stats'] as const,
  jobsRoot: ['jobs'] as const,
  automations: (workspaceId: string) => ['automation', workspaceId, 'list'] as const,
  automation: (workspaceId: string, id: string) =>
    ['automation', workspaceId, 'detail', id] as const,
  automationVersions: (workspaceId: string, id: string) =>
    ['automation', workspaceId, 'versions', id] as const,
  automationRoot: ['automation'] as const,
  executions: (workspaceId: string, status?: string) =>
    ['executions', workspaceId, 'list', status ?? 'all'] as const,
  execution: (workspaceId: string, id: string) =>
    ['executions', workspaceId, 'detail', id] as const,
  executionsRoot: ['executions'] as const,
  actions: ['automation-actions'] as const,
  controls: ['automation-controls'] as const,
};
