import { ArrowDown, ArrowUp, MousePointerClick, Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type { ActionInfo } from '@/api/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';
import { Badge } from '@/components/ui/surface';

import {
  bestUnit,
  DURATION_UNITS,
  END,
  KEY_PATTERN,
  moveStep,
  removeStep,
  removeTrigger,
  replaceStep,
  replaceTrigger,
  successors,
  type ApprovalConfig,
  type ConditionRule,
  type StepModel,
  type TriggerModel,
  type WorkflowModel,
} from './builderModel';

export type Selection = { type: 'step' | 'trigger'; index: number };

const KNOWN_EVENTS = [
  'invoicing.invoice_issued',
  'approvals.requested',
  'approvals.decided',
  'approvals.expired',
];
const TIMEZONES = ['Europe/Bucharest', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York'];
const CRON_PRESETS = [
  { label: 'Daily 09:00', expression: '0 9 * * *' },
  { label: 'Weekdays 09:00', expression: '0 9 * * 1-5' },
  { label: 'Mondays 09:00', expression: '0 9 * * 1' },
  { label: '1st of month', expression: '0 9 1 * *' },
];
const OPERATORS: { value: ConditionRule['op']; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equal' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'exists' },
];
const TEMPLATE_HINT = 'Use {{ trigger.field }} or {{ steps.<key>.<field> }} to insert values.';

// ----------------------------------------------------------------------- small fields

/** Key editor that commits on blur/Enter so partial typing never rewires references. */
function KeyField({
  value,
  taken,
  disabled,
  onCommit,
}: {
  value: string;
  taken: string[];
  disabled: boolean;
  onCommit: (key: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const error = !KEY_PATTERN.test(draft)
    ? 'Lowercase letters, digits and _; must start with a letter.'
    : draft === END
      ? `"${END}" is reserved.`
      : taken.includes(draft)
        ? 'Another step already uses this key.'
        : null;
  // Enter keeps an invalid draft (with its error) on screen; leaving the field reverts it.
  const commit = (revertInvalid: boolean) => {
    if (draft === value) return;
    if (!error) onCommit(draft);
    else if (revertInvalid) setDraft(value);
  };
  return (
    <Field
      label="Key"
      required
      error={draft !== value ? error : null}
      help="Referenced as steps.<key>."
    >
      {(p) => (
        <Input
          {...p}
          value={draft}
          disabled={disabled}
          maxLength={50}
          spellCheck={false}
          className="font-mono"
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          onBlur={() => commit(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(false);
            if (e.key === 'Escape') setDraft(value);
          }}
        />
      )}
    </Field>
  );
}

function DurationField({
  label,
  seconds,
  min,
  disabled,
  onChange,
}: {
  label: string;
  seconds: number;
  min: number;
  disabled: boolean;
  onChange: (seconds: number) => void;
}) {
  const [unit, setUnit] = useState<number>(() => bestUnit(seconds).seconds);
  const amount = seconds / unit;
  return (
    <Field label={label} error={seconds < min ? `Minimum is ${String(min)} seconds.` : null}>
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            type="number"
            min={0}
            step="any"
            value={Number.isFinite(amount) ? String(amount) : ''}
            disabled={disabled}
            onChange={(e) => onChange(Math.round(Number(e.target.value) * unit))}
          />
          <Select
            aria-label={`${label} unit`}
            value={String(unit)}
            disabled={disabled}
            className="w-32 shrink-0"
            onChange={(e) => setUnit(Number(e.target.value))}
          >
            {DURATION_UNITS.map((u) => (
              <option key={u.label} value={u.seconds}>
                {u.label}
              </option>
            ))}
          </Select>
        </div>
      )}
    </Field>
  );
}

/** Successor picker; empty value means "default" (the next step in the list). */
function TargetSelect({
  label,
  value,
  defaultLabel,
  keys,
  disabled,
  allowDefault = true,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  defaultLabel: string;
  keys: string[];
  disabled: boolean;
  allowDefault?: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      {(p) => (
        <Select
          {...p}
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          {allowDefault && <option value="">{defaultLabel}</option>}
          {keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
          <option value={END}>end (finish workflow)</option>
        </Select>
      )}
    </Field>
  );
}

function ApprovalFields({
  value,
  forceHigh,
  disabled,
  onChange,
}: {
  value: ApprovalConfig;
  forceHigh: boolean;
  disabled: boolean;
  onChange: (value: ApprovalConfig) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-danger/25 bg-danger/[0.04] p-3">
      <Field
        label="Risk level"
        help={forceHigh ? 'High-risk actions always need a high-risk approval.' : undefined}
      >
        {(p) => (
          <Select
            {...p}
            value={value.risk_level}
            disabled={disabled || forceHigh}
            onChange={(e) =>
              onChange({ ...value, risk_level: e.target.value as ApprovalConfig['risk_level'] })
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High (step-up authentication)</option>
          </Select>
        )}
      </Field>
      <Field label="Request title" help={TEMPLATE_HINT}>
        {(p) => (
          <Input
            {...p}
            value={value.title ?? ''}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        )}
      </Field>
      <Field label="Summary">
        {(p) => (
          <Textarea
            {...p}
            value={value.summary ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, summary: e.target.value })}
          />
        )}
      </Field>
      <DurationField
        label="Expires after"
        seconds={(value.expires_in_minutes ?? 1440) * 60}
        min={60}
        disabled={disabled}
        onChange={(s) =>
          onChange({ ...value, expires_in_minutes: Math.max(1, Math.round(s / 60)) })
        }
      />
    </div>
  );
}

// -------------------------------------------------------------------- action params

interface PropSchema {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  anyOf?: PropSchema[];
}

function propKind(prop: PropSchema): 'enum' | 'boolean' | 'integer' | 'json' | 'text' {
  if (prop.enum) return 'enum';
  const type = prop.type ?? prop.anyOf?.find((p) => p.type && p.type !== 'null')?.type;
  if (type === 'boolean') return 'boolean';
  if (type === 'integer') return 'integer';
  if (type === 'object' || type === 'array') return 'json';
  // Numbers stay strings: the server parses them (Decimal for money, never float).
  return 'text';
}

/** Display form of a stored value: strings as-is, other JSON values serialized. */
function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function humanize(key: string): string {
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function JsonParam({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <Field label={`${label} (JSON)`} error={error}>
      {(p) => (
        <Textarea
          {...p}
          value={text}
          disabled={disabled}
          spellCheck={false}
          className="font-mono text-xs"
          onChange={(e) => {
            setText(e.target.value);
            try {
              onChange(JSON.parse(e.target.value) as unknown);
              setError(null);
            } catch {
              setError('Invalid JSON — changes are applied once it parses.');
            }
          }}
        />
      )}
    </Field>
  );
}

function ParamsForm({
  action,
  params,
  disabled,
  onChange,
}: {
  action: ActionInfo;
  params: Record<string, unknown>;
  disabled: boolean;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const schema = action.params_schema as {
    properties?: Record<string, PropSchema>;
    required?: string[];
  };
  const properties = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const set = (key: string, value: unknown) => {
    const rest = Object.fromEntries(Object.entries(params).filter(([k]) => k !== key));
    onChange(value === undefined || value === '' ? rest : { ...rest, [key]: value });
  };
  if (properties.length === 0) return <p className="text-xs text-ink-dim">No parameters.</p>;
  return (
    <div className="space-y-3">
      {properties.map(([key, prop]) => {
        const label = prop.title ?? humanize(key);
        const kind = propKind(prop);
        const current = params[key];
        if (kind === 'boolean') {
          return (
            <SwitchField
              key={key}
              label={label}
              checked={Boolean(current)}
              disabled={disabled}
              onCheckedChange={(v) => set(key, v)}
            />
          );
        }
        if (kind === 'json') {
          return (
            <JsonParam
              key={`${action.name}:${key}`}
              label={label}
              value={current}
              disabled={disabled}
              onChange={(v) => set(key, v)}
            />
          );
        }
        if (kind === 'enum') {
          return (
            <Field key={key} label={label} required={required.has(key)} help={prop.description}>
              {(p) => (
                <Select
                  {...p}
                  value={asText(current)}
                  disabled={disabled}
                  onChange={(e) => set(key, e.target.value || undefined)}
                >
                  <option value="">—</option>
                  {(prop.enum ?? []).map((o) => (
                    <option key={String(o)} value={String(o)}>
                      {String(o)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          );
        }
        const text = asText(current);
        return (
          <Field key={key} label={label} required={required.has(key)} help={prop.description}>
            {(p) => (
              <Input
                {...p}
                value={text}
                disabled={disabled}
                inputMode={kind === 'integer' ? 'numeric' : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  set(key, kind === 'integer' && /^-?\d+$/.test(v) ? Number(v) : v);
                }}
              />
            )}
          </Field>
        );
      })}
      <p className="text-xs text-ink-dim">{TEMPLATE_HINT}</p>
    </div>
  );
}

// ---------------------------------------------------------------------- step forms

function ConditionRules({
  step,
  disabled,
  onChange,
}: {
  step: StepModel;
  disabled: boolean;
  onChange: (step: StepModel) => void;
}) {
  const rules = step.conditions ?? [];
  const setRule = (i: number, rule: ConditionRule) =>
    onChange({ ...step, conditions: rules.map((r, j) => (j === i ? rule : r)) });
  return (
    <div className="space-y-3">
      <Field label="Match">
        {(p) => (
          <Select
            {...p}
            value={step.mode ?? 'all'}
            disabled={disabled}
            onChange={(e) => onChange({ ...step, mode: e.target.value as 'all' | 'any' })}
          >
            <option value="all">All rules (AND)</option>
            <option value="any">Any rule (OR)</option>
          </Select>
        )}
      </Field>
      <ul className="space-y-2" aria-label="Rules">
        {rules.map((rule, i) => (
          <li key={i} className="space-y-2 rounded-md border border-line bg-base/40 p-2.5">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Rule ${String(i + 1)} value to check`}
                value={rule.left}
                placeholder="trigger.amount"
                disabled={disabled}
                spellCheck={false}
                className="font-mono text-xs"
                onChange={(e) => setRule(i, { ...rule, left: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove rule ${String(i + 1)}`}
                disabled={disabled || rules.length <= 1}
                onClick={() => onChange({ ...step, conditions: rules.filter((_, j) => j !== i) })}
              >
                <X />
              </Button>
            </div>
            <div className="flex gap-2">
              <Select
                aria-label={`Rule ${String(i + 1)} operator`}
                value={rule.op}
                disabled={disabled}
                className="w-32 shrink-0"
                onChange={(e) => {
                  const op = e.target.value as ConditionRule['op'];
                  setRule(i, op === 'exists' ? { left: rule.left, op } : { ...rule, op });
                }}
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {rule.op !== 'exists' && (
                <Input
                  aria-label={`Rule ${String(i + 1)} compare with`}
                  value={asText(rule.right)}
                  placeholder="1000"
                  disabled={disabled}
                  onChange={(e) => setRule(i, { ...rule, right: e.target.value })}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || rules.length >= 20}
        onClick={() =>
          onChange({ ...step, conditions: [...rules, { left: '', op: 'eq', right: '' }] })
        }
      >
        <Plus /> Add rule
      </Button>
      <p className="text-xs text-ink-dim">
        Paths start with trigger., steps. or execution. Numeric comparisons are exact (no floating
        point) and fail closed on non-numbers.
      </p>
    </div>
  );
}

function ActionFields({
  step,
  catalog,
  disabled,
  onChange,
}: {
  step: StepModel;
  catalog: ActionInfo[];
  disabled: boolean;
  onChange: (step: StepModel) => void;
}) {
  const action = catalog.find((a) => a.name === step.action);
  const groups = new Map<string, ActionInfo[]>();
  for (const a of catalog) {
    const ns = a.name.split('.')[0] ?? 'core';
    groups.set(ns, [...(groups.get(ns) ?? []), a]);
  }
  const forceHigh = action?.risk === 'high';
  const requiresApproval = action?.requires_approval ?? false;
  const defaultApproval = (): ApprovalConfig => ({
    risk_level: forceHigh ? 'high' : 'medium',
    title: action ? `Confirm: ${action.title}` : 'Please confirm',
    expires_in_minutes: 1440,
  });

  return (
    <div className="space-y-3">
      <Field label="Action" required help={action?.description}>
        {(p) => (
          <Select
            {...p}
            value={step.action ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const next = catalog.find((a) => a.name === e.target.value);
              const approval =
                next?.requires_approval || step.approval
                  ? {
                      ...(step.approval ?? defaultApproval()),
                      ...(next?.risk === 'high' ? { risk_level: 'high' as const } : {}),
                    }
                  : undefined;
              onChange({ ...step, action: e.target.value, params: {}, approval });
            }}
          >
            {!action && (
              <option value={step.action ?? ''}>{step.action || 'Choose an action'}</option>
            )}
            {[...groups].map(([ns, actions]) => (
              <optgroup key={ns} label={ns}>
                {actions.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.title} ({a.name})
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      {action && (
        <div className="flex flex-wrap gap-1.5">
          <Badge
            tone={
              action.risk === 'high' ? 'danger' : action.risk === 'medium' ? 'warning' : 'success'
            }
          >
            risk {action.risk}
          </Badge>
          {action.side_effecting && <Badge tone="violet">side effects</Badge>}
          {requiresApproval && <Badge tone="danger">approval required</Badge>}
        </div>
      )}
      {!action && step.action && (
        <Alert tone="warning">This action is not in the catalog; the server will reject it.</Alert>
      )}
      {action && (
        <section aria-label="Parameters" className="space-y-2">
          <p className="label-caps">Parameters</p>
          <ParamsForm
            key={action.name}
            action={action}
            params={step.params ?? {}}
            disabled={disabled}
            onChange={(params) => onChange({ ...step, params })}
          />
        </section>
      )}
      <SwitchField
        label={requiresApproval ? 'Approval required by this action' : 'Ask for approval first'}
        checked={Boolean(step.approval) || requiresApproval}
        disabled={disabled || requiresApproval}
        onCheckedChange={(on) =>
          onChange({ ...step, approval: on ? defaultApproval() : undefined })
        }
      />
      {step.approval && (
        <ApprovalFields
          value={step.approval}
          forceHigh={forceHigh}
          disabled={disabled}
          onChange={(approval) => onChange({ ...step, approval })}
        />
      )}
    </div>
  );
}

function StepFields({
  step,
  catalog,
  disabled,
  onChange,
}: {
  step: StepModel;
  catalog: ActionInfo[];
  disabled: boolean;
  onChange: (step: StepModel) => void;
}) {
  switch (step.type) {
    case 'action':
      return <ActionFields step={step} catalog={catalog} disabled={disabled} onChange={onChange} />;
    case 'condition':
      return <ConditionRules step={step} disabled={disabled} onChange={onChange} />;
    case 'approval':
      return (
        <ApprovalFields
          value={step.approval ?? { risk_level: 'medium' }}
          forceHigh={false}
          disabled={disabled}
          onChange={(approval) => onChange({ ...step, approval })}
        />
      );
    case 'notify':
      return (
        <div className="space-y-3">
          <Field label="Title" required help={TEMPLATE_HINT}>
            {(p) => (
              <Input
                {...p}
                value={step.message_title ?? ''}
                maxLength={200}
                disabled={disabled}
                onChange={(e) => onChange({ ...step, message_title: e.target.value })}
              />
            )}
          </Field>
          <Field label="Message">
            {(p) => (
              <Textarea
                {...p}
                value={step.message_body ?? ''}
                maxLength={4000}
                disabled={disabled}
                onChange={(e) => onChange({ ...step, message_body: e.target.value })}
              />
            )}
          </Field>
          <Field label="Severity">
            {(p) => (
              <Select
                {...p}
                value={step.severity ?? 'info'}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...step, severity: e.target.value as StepModel['severity'] })
                }
              >
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </Select>
            )}
          </Field>
        </div>
      );
    case 'delay':
      return (
        <DurationField
          label="Wait for"
          seconds={step.seconds ?? 0}
          min={1}
          disabled={disabled}
          onChange={(seconds) => onChange({ ...step, seconds })}
        />
      );
  }
}

// --------------------------------------------------------------------- trigger form

function TriggerFields({
  trigger,
  disabled,
  onChange,
}: {
  trigger: TriggerModel;
  disabled: boolean;
  onChange: (trigger: TriggerModel) => void;
}) {
  if (trigger.type === 'manual') {
    return (
      <p className="text-sm text-ink-muted">
        Runs when you start it from the builder (Run / Dry run) or through the API.
      </p>
    );
  }
  if (trigger.type === 'interval') {
    return (
      <DurationField
        label="Every"
        seconds={trigger.seconds ?? 3600}
        min={60}
        disabled={disabled}
        onChange={(seconds) => onChange({ ...trigger, seconds })}
      />
    );
  }
  if (trigger.type === 'event') {
    return (
      <Field
        label="Event type"
        required
        help="The trigger payload is the event's data, available as {{ trigger.<field> }}."
      >
        {(p) => (
          <>
            <Input
              {...p}
              list="workflow-known-events"
              value={trigger.event_type ?? ''}
              disabled={disabled}
              spellCheck={false}
              className="font-mono"
              onChange={(e) => onChange({ ...trigger, event_type: e.target.value })}
            />
            <datalist id="workflow-known-events">
              {KNOWN_EVENTS.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </>
        )}
      </Field>
    );
  }
  return (
    <div className="space-y-3">
      <Field label="Cron expression" required help="minute hour day-of-month month day-of-week">
        {(p) => (
          <Input
            {...p}
            value={trigger.expression ?? ''}
            maxLength={100}
            disabled={disabled}
            spellCheck={false}
            className="font-mono"
            onChange={(e) => onChange({ ...trigger, expression: e.target.value })}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map((preset) => (
          <Button
            key={preset.expression}
            size="sm"
            variant={trigger.expression === preset.expression ? 'secondary' : 'outline'}
            disabled={disabled}
            onClick={() => onChange({ ...trigger, expression: preset.expression })}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <Field label="Timezone">
        {(p) => (
          <>
            <Input
              {...p}
              list="workflow-timezones"
              value={trigger.timezone ?? 'Europe/Bucharest'}
              disabled={disabled}
              onChange={(e) => onChange({ ...trigger, timezone: e.target.value })}
            />
            <datalist id="workflow-timezones">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </>
        )}
      </Field>
    </div>
  );
}

// ------------------------------------------------------------------------ inspector

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <p className="label-caps">{title}</p>
      {children}
    </section>
  );
}

/** Typed editor for the selected trigger or step; every change rewrites the definition. */
export function StepInspector({
  model,
  selection,
  issues,
  catalog,
  canEdit,
  onChange,
}: {
  model: WorkflowModel;
  selection: Selection | null;
  issues: string[];
  catalog: ActionInfo[];
  canEdit: boolean;
  onChange: (model: WorkflowModel, selection?: Selection | null) => void;
}) {
  const disabled = !canEdit;

  if (!selection) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <MousePointerClick className="size-5 text-ink-dim" aria-hidden />
        <p className="text-sm text-ink-muted">Select a trigger or step on the canvas to edit it.</p>
        <p className="text-xs text-ink-dim">
          Drag from a node&apos;s bottom handle to another node to change where it continues.
        </p>
      </div>
    );
  }

  const issueList = issues.length > 0 && (
    <Alert tone="danger">
      <ul className="space-y-0.5">
        {issues.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </Alert>
  );

  if (selection.type === 'trigger') {
    const trigger = model.triggers[selection.index];
    if (!trigger) return null;
    const update = (t: TriggerModel) => onChange(replaceTrigger(model, selection.index, t));
    const takenKeys = model.triggers
      .filter((_, i) => i !== selection.index)
      .map((t) => t.key ?? t.type);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone="info">{trigger.type} trigger</Badge>
          <span className="flex-1" />
          <Button
            variant="danger"
            size="sm"
            disabled={disabled || model.triggers.length <= 1}
            title={model.triggers.length <= 1 ? 'A workflow needs at least one trigger' : undefined}
            onClick={() => onChange(removeTrigger(model, selection.index), null)}
          >
            <Trash2 /> Remove
          </Button>
        </div>
        {issueList}
        <KeyField
          key={`t${String(selection.index)}:${trigger.key ?? ''}`}
          value={trigger.key ?? (trigger.type === 'manual' ? 'manual' : '')}
          taken={takenKeys}
          disabled={disabled}
          onCommit={(key) => update({ ...trigger, key })}
        />
        <TriggerFields trigger={trigger} disabled={disabled} onChange={update} />
      </div>
    );
  }

  const step = model.steps[selection.index];
  if (!step) return null;
  const index = selection.index;
  const update = (s: StepModel) => onChange(replaceStep(model, index, s));
  const otherKeys = model.steps.filter((_, i) => i !== index).map((s) => s.key);
  const listNext = model.steps[index + 1]?.key ?? END;
  const plain = step.next ?? listNext;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <Badge tone="electric">{step.type}</Badge>
        <span className="font-mono text-xs text-ink-dim">
          #{String(index + 1)} of {String(model.steps.length)}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move step up"
          disabled={disabled || index === 0}
          onClick={() => onChange(moveStep(model, index, -1), { type: 'step', index: index - 1 })}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move step down"
          disabled={disabled || index === model.steps.length - 1}
          onClick={() => onChange(moveStep(model, index, 1), { type: 'step', index: index + 1 })}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="danger"
          size="icon-sm"
          aria-label="Delete step"
          disabled={disabled}
          onClick={() => onChange(removeStep(model, index), null)}
        >
          <Trash2 />
        </Button>
      </div>
      {issueList}
      <Section title="General">
        <KeyField
          key={`s${String(index)}:${step.key}`}
          value={step.key}
          taken={otherKeys}
          disabled={disabled}
          onCommit={(key) => update({ ...step, key })}
        />
        <Field label="Title" help="Optional label shown on the canvas.">
          {(p) => (
            <Input
              {...p}
              value={step.title ?? ''}
              maxLength={200}
              disabled={disabled}
              onChange={(e) => update({ ...step, title: e.target.value })}
            />
          )}
        </Field>
      </Section>
      <Section title="Configuration">
        <StepFields step={step} catalog={catalog} disabled={disabled} onChange={update} />
      </Section>
      <Section title="Flow">
        {step.type === 'condition' ? (
          <>
            <TargetSelect
              label="When true, continue to"
              value={step.on_true ?? step.next}
              defaultLabel={`Default — ${listNext}`}
              keys={otherKeys}
              disabled={disabled}
              onChange={(v) => update({ ...step, on_true: v, next: undefined })}
            />
            <TargetSelect
              label="When false, continue to"
              value={step.on_false ?? END}
              defaultLabel=""
              allowDefault={false}
              keys={otherKeys}
              disabled={disabled}
              onChange={(v) => update({ ...step, on_false: v ?? END })}
            />
          </>
        ) : (
          <TargetSelect
            label="Then continue to"
            value={step.next}
            defaultLabel={`Default — ${listNext}`}
            keys={otherKeys}
            disabled={disabled}
            onChange={(v) => update({ ...step, next: v })}
          />
        )}
        <p className="text-xs text-ink-dim">
          Currently continues to{' '}
          <span className="font-mono text-ink-muted">
            {successors(model, index)
              .map((s) => (s.label ? `${s.label} → ${s.target}` : s.target))
              .join(', ') || plain}
          </span>
          .
        </p>
      </Section>
    </div>
  );
}
