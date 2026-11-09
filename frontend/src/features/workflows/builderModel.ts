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
    ? (raw.triggers.filter(
        (t) => isRecord(t) && typeof t.type === 'string',
      ) as unknown as TriggerModel[])
    : [{ type: 'manual' as const }];
  return { triggers, steps };
}

/** Removes empty optional fields so the saved definition stays clean. */
export function toDefinition(model: WorkflowModel): Record<string, unknown> {
  const clean = (obj: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
  return {
    triggers: model.triggers.map((t) => clean({ ...t })),
    steps: model.steps.map((s) => clean({ ...s })),
  };
}

export function uniqueKey(base: string, taken: string[]): string {
  const root =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^[^a-z]+/, 's_')
      .slice(0, 40) || 'step';
  if (!taken.includes(root)) return root;
  let i = 2;
  while (taken.includes(`${root}_${String(i)}`)) i += 1;
  return `${root}_${String(i)}`;
}

export function newStep(kind: StepKind, taken: string[]): StepModel {
  const key = uniqueKey(kind, taken);
  switch (kind) {
    case 'action':
      return {
        key,
        type: 'action',
        action: 'core.log',
        params: { message: 'Hello from Personal OS' },
      };
    case 'condition':
      return {
        key,
        type: 'condition',
        conditions: [{ left: 'trigger.amount', op: 'gt', right: '100' }],
        mode: 'all',
        on_false: END,
      };
    case 'approval':
      return {
        key,
        type: 'approval',
        approval: { risk_level: 'medium', title: 'Please confirm', expires_in_minutes: 1440 },
      };
    case 'notify':
      return {
        key,
        type: 'notify',
        message_title: 'Workflow update',
        message_body: '',
        severity: 'info',
      };
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
export function successors(
  model: WorkflowModel,
  index: number,
): { target: string; label?: string }[] {
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
  if (t.type === 'interval') return `every ${formatDuration(t.seconds ?? 0)}`;
  if (t.type === 'event') return t.event_type ?? 'event';
  return 'run on demand';
}

export function describeStep(s: StepModel): string {
  if (s.type === 'action') return s.action ?? 'action';
  if (s.type === 'condition') {
    const c = s.conditions?.[0];
    const more =
      (s.conditions?.length ?? 0) > 1 ? ` +${String((s.conditions?.length ?? 1) - 1)}` : '';
    return c
      ? `${c.left} ${c.op} ${c.right === undefined ? '' : JSON.stringify(c.right)}${more}`
      : 'condition';
  }
  if (s.type === 'approval') return `risk ${s.approval?.risk_level ?? 'medium'}`;
  if (s.type === 'notify') return s.message_title ?? 'notification';
  return `wait ${formatDuration(s.seconds ?? 0)}`;
}

// ------------------------------------------------------------------ editing operations

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;
const EVENT_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** Fields through which a step references another step. */
const REF_FIELDS = ['next', 'on_true', 'on_false'] as const;

function retarget(step: StepModel, from: string, to: string): StepModel {
  const copy: StepModel = { ...step };
  for (const field of REF_FIELDS) {
    if (copy[field] === from) copy[field] = to;
  }
  return copy;
}

/** Replaces a step; renaming its key also rewires every reference to it. */
export function replaceStep(model: WorkflowModel, index: number, step: StepModel): WorkflowModel {
  const previous = model.steps[index];
  if (!previous) return model;
  let steps = model.steps.map((s, i) => (i === index ? step : s));
  if (previous.key !== step.key) steps = steps.map((s) => retarget(s, previous.key, step.key));
  return { ...model, steps };
}

export function replaceTrigger(
  model: WorkflowModel,
  index: number,
  trigger: TriggerModel,
): WorkflowModel {
  return { ...model, triggers: model.triggers.map((t, i) => (i === index ? trigger : t)) };
}

/** Inserts a new step after `afterIndex` (or appends) so it sits on the selected step's path. */
export function insertStep(
  model: WorkflowModel,
  kind: StepKind,
  afterIndex: number | null,
): { model: WorkflowModel; index: number } {
  const step = newStep(
    kind,
    model.steps.map((s) => s.key),
  );
  const steps = [...model.steps];
  const at = afterIndex === null ? steps.length : afterIndex + 1;
  const before = afterIndex === null ? undefined : steps[afterIndex];
  if (afterIndex !== null && before && before.type !== 'condition' && before.next) {
    step.next = before.next;
    steps[afterIndex] = { ...before, next: undefined };
  }
  steps.splice(at, 0, step);
  return { model: { ...model, steps }, index: at };
}

/** Removes a step; anything pointing at it continues where the removed step would have. */
export function removeStep(model: WorkflowModel, index: number): WorkflowModel {
  const removed = model.steps[index];
  if (!removed) return model;
  const continuation = successors(model, index)[0]?.target ?? END;
  const to = continuation === removed.key ? END : continuation;
  const steps = model.steps.filter((_, i) => i !== index).map((s) => retarget(s, removed.key, to));
  return { ...model, steps };
}

export function moveStep(model: WorkflowModel, index: number, delta: -1 | 1): WorkflowModel {
  const target = index + delta;
  if (target < 0 || target >= model.steps.length) return model;
  const steps = [...model.steps];
  const [step] = steps.splice(index, 1);
  if (step) steps.splice(target, 0, step);
  return { ...model, steps };
}

export function addTrigger(model: WorkflowModel, kind: TriggerKind): WorkflowModel {
  const taken = model.triggers.map((t) => t.key ?? t.type);
  return { ...model, triggers: [...model.triggers, newTrigger(kind, taken)] };
}

export function removeTrigger(model: WorkflowModel, index: number): WorkflowModel {
  return { ...model, triggers: model.triggers.filter((_, i) => i !== index) };
}

export type Branch = 'next' | 'true' | 'false';

/** Points a step's outgoing branch at another step key (or END). */
export function connect(
  model: WorkflowModel,
  sourceKey: string,
  branch: Branch,
  targetKey: string,
): WorkflowModel {
  const index = model.steps.findIndex((s) => s.key === sourceKey);
  const step = model.steps[index];
  if (!step || targetKey === sourceKey) return model;
  const updated: StepModel = { ...step };
  if (step.type === 'condition' && branch === 'false') updated.on_false = targetKey;
  else if (step.type === 'condition' && branch === 'true') updated.on_true = targetKey;
  else updated.next = targetKey;
  return replaceStep(model, index, updated);
}

// ------------------------------------------------------------------------ validation

export interface Issue {
  /** `step:<key>`, `trigger:<index>` or `workflow`. */
  target: string;
  message: string;
}

/** Fast client-side checks mirroring the server rules; the server stays authoritative. */
export function validateModel(model: WorkflowModel): Issue[] {
  const issues: Issue[] = [];
  const add = (target: string, message: string) => issues.push({ target, message });
  if (model.steps.length === 0) add('workflow', 'Add at least one step.');
  if (model.steps.length > 50) add('workflow', 'At most 50 steps are allowed.');
  if (model.triggers.length > 10) add('workflow', 'At most 10 triggers are allowed.');

  const triggerKeys = new Set<string>();
  model.triggers.forEach((t, i) => {
    const target = `trigger:${String(i)}`;
    const key = t.key ?? (t.type === 'manual' ? 'manual' : '');
    if (!KEY_PATTERN.test(key)) add(target, 'Trigger key must be snake_case.');
    if (triggerKeys.has(key)) add(target, `Duplicate trigger key "${key}".`);
    triggerKeys.add(key);
    if (t.type === 'cron' && !(t.expression ?? '').trim()) add(target, 'Cron expression required.');
    if (t.type === 'interval' && (t.seconds ?? 0) < 60)
      add(target, 'Interval is at least 1 minute.');
    if (t.type === 'event') {
      if (!EVENT_PATTERN.test(t.event_type ?? '')) add(target, 'Use "module.event_name".');
      if ((t.event_type ?? '').startsWith('automation.')) {
        add(target, 'Automation events cannot trigger automations.');
      }
    }
  });

  const known = new Set([...model.steps.map((s) => s.key), END]);
  const seen = new Set<string>();
  model.steps.forEach((s, i) => {
    const target = `step:${s.key}`;
    if (!KEY_PATTERN.test(s.key)) add(target, 'Key must be snake_case (a-z, 0-9, _).');
    if (s.key === END) add(target, `"${END}" is reserved.`);
    if (seen.has(s.key)) add(target, `Duplicate key "${s.key}".`);
    seen.add(s.key);
    for (const { target: next } of successors(model, i)) {
      if (!known.has(next)) add(target, `Points to unknown step "${next}".`);
    }
    if (s.type === 'action' && !s.action) add(target, 'Choose an action.');
    if (s.type === 'notify' && !(s.message_title ?? '').trim()) add(target, 'Title is required.');
    if (s.type === 'condition') {
      if (!s.conditions?.length) add(target, 'Add at least one rule.');
      else if (s.conditions.some((c) => !c.left.trim())) add(target, 'Every rule needs a value.');
    }
    if (s.type === 'delay' && (s.seconds ?? 0) < 1) add(target, 'Delay must be at least 1 second.');
  });

  const cycle = findCycle(model);
  if (cycle) add(`step:${cycle}`, 'The workflow loops back to this step (cycles are not allowed).');
  return issues;
}

function findCycle(model: WorkflowModel): string | null {
  const index = new Map(model.steps.map((s, i) => [s.key, i]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string): string | null => {
    const i = index.get(key);
    if (i === undefined || state.get(key) === 'done') return null;
    if (state.get(key) === 'visiting') return key;
    state.set(key, 'visiting');
    for (const { target } of successors(model, i)) {
      const found = visit(target);
      if (found) return found;
    }
    state.set(key, 'done');
    return null;
  };
  for (const s of model.steps) {
    const found = visit(s.key);
    if (found) return found;
  }
  return null;
}

// ------------------------------------------------------------------------- durations

export const DURATION_UNITS = [
  { label: 'seconds', seconds: 1 },
  { label: 'minutes', seconds: 60 },
  { label: 'hours', seconds: 3600 },
  { label: 'days', seconds: 86400 },
] as const;

export type DurationUnit = (typeof DURATION_UNITS)[number];

/** Largest unit that divides the duration evenly (3600 → hours, 90 → seconds). */
export function bestUnit(seconds: number): DurationUnit {
  for (let i = DURATION_UNITS.length - 1; i > 0; i -= 1) {
    const unit = DURATION_UNITS[i];
    if (unit && seconds >= unit.seconds && seconds % unit.seconds === 0) return unit;
  }
  return DURATION_UNITS[0];
}

export function formatDuration(seconds: number): string {
  const unit = bestUnit(seconds);
  const value = seconds / unit.seconds;
  return `${String(value)} ${value === 1 ? unit.label.slice(0, -1) : unit.label}`;
}
