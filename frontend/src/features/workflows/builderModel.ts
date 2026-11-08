/** Editable workflow model used by the visual builder (mirrors the backend schema). */

export type StepKind = 'action' | 'condition' | 'approval' | 'notify' | 'delay';
export type TriggerKind = 'manual' | 'cron' | 'interval' | 'event';

export interface ApprovalConfig {
  risk_level: 'low' | 'medium' | 'high';
  title?: string;
  summary?: string;
  expires_in_minutes?: number;
}

export interface ConditionRule {
  left: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists';
  right?: unknown;
}

export interface StepModel {
  key: string;
  type: StepKind;
  title?: string;
  next?: string | null;
  // action
  action?: string;
  params?: Record<string, unknown>;
  approval?: ApprovalConfig | null;
  // condition
  conditions?: ConditionRule[];
  mode?: 'all' | 'any';
  on_true?: string | null;
  on_false?: string;
  // notify
  message_title?: string;
  message_body?: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  // delay
  seconds?: number;
}

export interface TriggerModel {
  type: TriggerKind;
  key?: string;
  expression?: string;
  timezone?: string;
  seconds?: number;
  event_type?: string;
}

export interface WorkflowModel {
  schema_version?: 1;
  triggers: TriggerModel[];
  steps: StepModel[];
}

export const END = 'end';

/** Integration-backed action namespaces → provider shown on the node. */
export const INTEGRATION_ACTIONS: Record<string, string> = {
  invoicing: 'Oblio',
  calendar: 'Google Calendar',
  documents: 'Google',
};

export function integrationFor(action: string | undefined): string | null {
  if (!action) return null;
  return INTEGRATION_ACTIONS[action.split('.')[0] ?? ''] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lenient parse for editing; the server performs full validation on save. */
export function toModel(raw: unknown): WorkflowModel {
  if (!isRecord(raw)) return { triggers: [{ type: 'manual' }], steps: [] };
  const steps = Array.isArray(raw.steps)
    ? (raw.steps.filter((s) => isRecord(s) && typeof s.key === 'string') as unknown as StepModel[])
    : [];
  const triggers = Array.isArray(raw.triggers)
    ? (raw.triggers.filter((t) => isRecord(t) && typeof t.type === 'string') as unknown as TriggerModel[])
    : [{ type: 'manual' as const }];
  return { triggers, steps };
}

/** Removes empty optional fields so the saved definition stays clean. */
export function toDefinition(model: WorkflowModel): Record<string, unknown> {
  const clean = (obj: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return {
    triggers: model.triggers.map((t) => clean({ ...t })),
    steps: model.steps.map((s) => clean({ ...s })),
  };
}

export function uniqueKey(base: string, taken: string[]): string {
  const root = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 's_').slice(0, 40) || 'step';
  if (!taken.includes(root)) return root;
  let i = 2;
  while (taken.includes(`${root}_${String(i)}`)) i += 1;
  return `${root}_${String(i)}`;
}

export function newStep(kind: StepKind, taken: string[]): StepModel {
  const key = uniqueKey(kind, taken);
  switch (kind) {
    case 'action':
      return { key, type: 'action', action: 'core.log', params: { message: 'Hello from Personal OS' } };
    case 'condition':
      return { key, type: 'condition', conditions: [{ left: 'trigger.amount', op: 'gt', right: '100' }], mode: 'all', on_false: END };
    case 'approval':
      return { key, type: 'approval', approval: { risk_level: 'medium', title: 'Please confirm', expires_in_minutes: 1440 } };
    case 'notify':
      return { key, type: 'notify', message_title: 'Workflow update', message_body: '', severity: 'info' };
    case 'delay':
      return { key, type: 'delay', seconds: 3600 };
  }
}

export function newTrigger(kind: TriggerKind, taken: string[]): TriggerModel {
  const key = uniqueKey(kind, taken);
  switch (kind) {
    case 'manual':
      return { type: 'manual', key };
    case 'cron':
      return { type: 'cron', key, expression: '0 9 * * 1', timezone: 'Europe/Bucharest' };
    case 'interval':
      return { type: 'interval', key, seconds: 3600 };
    case 'event':
      return { type: 'event', key, event_type: 'invoicing.invoice_issued' };
  }
}

/** Successors exactly as the engine computes them. */
export function successors(model: WorkflowModel, index: number): { target: string; label?: string }[] {
  const step = model.steps[index];
  if (!step) return [];
  const fallback = step.next ?? model.steps[index + 1]?.key ?? END;
  if (step.type === 'condition') {
    return [
      { target: step.on_true ?? fallback, label: 'true' },
      { target: step.on_false ?? END, label: 'false' },
    ];
  }
  return [{ target: fallback }];
}

export function describeTrigger(t: TriggerModel): string {
  if (t.type === 'cron') return `${t.expression ?? ''} · ${t.timezone ?? 'Europe/Bucharest'}`;
  if (t.type === 'interval') return `every ${String(Math.round((t.seconds ?? 0) / 60))} min`;
  if (t.type === 'event') return t.event_type ?? 'event';
  return 'run on demand';
}

export function describeStep(s: StepModel): string {
  if (s.type === 'action') return s.action ?? 'action';
  if (s.type === 'condition') {
    const c = s.conditions?.[0];
    const more = (s.conditions?.length ?? 0) > 1 ? ` +${String((s.conditions?.length ?? 1) - 1)}` : '';
    return c ? `${c.left} ${c.op} ${c.right === undefined ? '' : JSON.stringify(c.right)}${more}` : 'condition';
  }
  if (s.type === 'approval') return `risk ${s.approval?.risk_level ?? 'medium'}`;
  if (s.type === 'notify') return s.message_title ?? 'notification';
  return `wait ${String(Math.round((s.seconds ?? 0) / 60))} min`;
}
