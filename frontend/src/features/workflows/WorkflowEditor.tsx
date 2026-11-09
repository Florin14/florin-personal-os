import type { Connection } from '@xyflow/react';
import {
  AlertTriangle,
  Bell,
  Braces,
  CalendarClock,
  ExternalLink,
  FlaskConical,
  GitBranch,
  History,
  Hourglass,
  Play,
  Plus,
  Radio,
  Repeat,
  Save,
  ShieldCheck,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  useActionCatalog,
  useAutomationExecutions,
  useAutomationVersions,
  useExecution,
  useRunAutomation,
  useSaveAutomation,
  useSetAutomationEnabled,
} from '@/api/automation';
import { errorMessage } from '@/api/client';
import type { Automation } from '@/api/types';
import { dateTime, relativeTime, statusLabel } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlay';
import { Badge, Panel } from '@/components/ui/surface';

import {
  buildWorkflowGraph,
  END_NODE_ID,
  parseNodeId,
  stepNodeId,
  triggerNodeId,
  type RunOverlay,
} from './builderGraph';
import {
  addTrigger,
  connect,
  END,
  insertStep,
  toDefinition,
  toModel,
  validateModel,
  type Branch,
  type Issue,
  type StepKind,
  type TriggerKind,
  type WorkflowModel,
} from './builderModel';
import { StepInspector, type Selection } from './StepInspector';
import { TEMPLATES } from './templates';
import { WorkflowCanvas } from './WorkflowCanvas';

type Parsed = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

function parseJson(text: string): Parsed {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, error: 'The definition must be a JSON object.' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const STEP_KINDS: { kind: StepKind; label: string; hint: string; icon: LucideIcon }[] = [
  { kind: 'action', label: 'Action', hint: 'Run a catalog action or integration', icon: Zap },
  { kind: 'condition', label: 'Condition', hint: 'Branch on values', icon: GitBranch },
  { kind: 'approval', label: 'Approval', hint: 'Wait for a human decision', icon: ShieldCheck },
  { kind: 'notify', label: 'Notify', hint: 'Send a notification', icon: Bell },
  { kind: 'delay', label: 'Delay', hint: 'Pause before continuing', icon: Hourglass },
];

const TRIGGER_KINDS: { kind: TriggerKind; label: string; icon: LucideIcon }[] = [
  { kind: 'manual', label: 'Manual', icon: Play },
  { kind: 'cron', label: 'Schedule (cron)', icon: CalendarClock },
  { kind: 'interval', label: 'Interval', icon: Repeat },
  { kind: 'event', label: 'Domain event', icon: Radio },
];

function selectionFor(issue: Issue, model: WorkflowModel): Selection | null {
  const [type, ref] = issue.target.split(':');
  if (type === 'trigger') return { type: 'trigger', index: Number(ref) };
  if (type === 'step') {
    const index = model.steps.findIndex((s) => s.key === ref);
    return index >= 0 ? { type: 'step', index } : null;
  }
  return null;
}

function selectionIssues(issues: Issue[], selection: Selection | null, model: WorkflowModel) {
  if (!selection) return [];
  const target =
    selection.type === 'trigger'
      ? `trigger:${String(selection.index)}`
      : `step:${model.steps[selection.index]?.key ?? ''}`;
  return issues.filter((i) => i.target === target).map((i) => i.message);
}

function RunPanel({
  workspaceId,
  automation,
  onStarted,
}: {
  workspaceId: string;
  automation: Automation;
  onStarted: (executionId: string) => void;
}) {
  const run = useRunAutomation(workspaceId);
  const [payloadText, setPayloadText] = useState('{}');
  const payload = useMemo(() => parseJson(payloadText), [payloadText]);
  const start = (dryRun: boolean) => {
    if (!payload.ok) return;
    run.mutate(
      { id: automation.id, dryRun, payload: payload.value },
      { onSuccess: (execution) => onStarted(execution.id) },
    );
  };
  return (
    <Panel title="Run" icon={<Play />}>
      <div className="space-y-3">
        <Field
          label="Trigger payload (JSON)"
          error={payload.ok ? null : payload.error}
          help="Available to steps as {{ trigger.<field> }}."
        >
          {(p) => (
            <Textarea
              {...p}
              value={payloadText}
              spellCheck={false}
              className="min-h-16 font-mono text-xs"
              onChange={(e) => setPayloadText(e.target.value)}
            />
          )}
        </Field>
        {run.isError && <Alert tone="danger">{errorMessage(run.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => start(true)}
            disabled={!payload.ok}
            loading={run.isPending && run.variables.dryRun}
          >
            <FlaskConical /> Dry run
          </Button>
          <Button
            variant="primary"
            onClick={() => start(false)}
            disabled={!payload.ok || !automation.enabled}
            loading={run.isPending && !run.variables.dryRun}
            title={automation.enabled ? undefined : 'Enable the automation to run it'}
          >
            <Play /> Run now
          </Button>
        </div>
        <p className="text-xs text-ink-dim">
          Dry runs simulate side-effecting actions. Runs use the last saved version, not unsaved
          changes.
        </p>
      </div>
    </Panel>
  );
}

function VersionsPanel({
  workspaceId,
  automation,
  canEdit,
  onLoad,
}: {
  workspaceId: string;
  automation: Automation;
  canEdit: boolean;
  onLoad: (definition: Record<string, unknown>) => void;
}) {
  const versions = useAutomationVersions(workspaceId, automation.id);
  if (!versions.data?.length) return null;
  return (
    <Panel title={`Versions (${String(versions.data.length)})`} icon={<History />}>
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        {versions.data.map((v) => (
          <li
            key={v.version}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/[0.03]"
          >
            <span className="font-mono text-ink">v{String(v.version)}</span>
            {v.version === automation.version && <Badge tone="success">current</Badge>}
            <span className="truncate text-xs text-ink-dim" title={dateTime(v.created_at)}>
              {relativeTime(v.created_at)} · {v.definition_hash.slice(0, 8)}
            </span>
            <span className="flex-1" />
            {v.version !== automation.version && canEdit && (
              <Button size="sm" variant="ghost" onClick={() => onLoad(v.definition)}>
                Load
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-dim">
        Loading a version puts it in the editor; saving it creates a new version.
      </p>
    </Panel>
  );
}

export function WorkflowEditor({
  workspaceId,
  automation,
  canEdit,
}: {
  workspaceId: string;
  automation?: Automation;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const save = useSaveAutomation(workspaceId);
  const toggle = useSetAutomationEnabled(workspaceId);
  const catalog = useActionCatalog();

  const initial = automation?.definition ?? TEMPLATES[0]?.definition ?? { steps: [] };
  const [name, setName] = useState(automation?.name ?? TEMPLATES[0]?.label ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  // The definition is the single source of truth; the model, graph and JSON derive from it.
  const [definition, setDefinition] = useState<Record<string, unknown>>(initial);
  const [jsonText, setJsonText] = useState(() => pretty(initial));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [view, setView] = useState<'visual' | 'json'>('visual');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showRun, setShowRun] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const model = useMemo(() => toModel(definition), [definition]);
  const issues = useMemo(() => validateModel(model), [model]);

  const executions = useAutomationExecutions(workspaceId, automation?.id);
  const activeRunId = runId ?? executions.data?.[0]?.id;
  const execution = useExecution(workspaceId, showRun ? activeRunId : undefined);
  const overlay = useMemo<RunOverlay | null>(() => {
    if (!showRun || !execution.data) return null;
    return {
      status: execution.data.status,
      triggerKey: execution.data.trigger_key,
      currentStepKey: execution.data.current_step_key ?? null,
      steps: execution.data.steps,
    };
  }, [showRun, execution.data]);

  const graph = useMemo(
    () => buildWorkflowGraph(model, { issues, overlay, editable: canEdit }),
    [model, issues, overlay, canEdit],
  );

  const setRaw = (next: Record<string, unknown>) => {
    setDefinition(next);
    setJsonText(pretty(next));
    setJsonError(null);
  };
  const applyModel = (next: WorkflowModel, nextSelection?: Selection | null) => {
    setRaw(toDefinition(next));
    if (nextSelection !== undefined) setSelection(nextSelection);
  };
  const onJsonChange = (text: string) => {
    setJsonText(text);
    const parsed = parseJson(text);
    if (parsed.ok) {
      setDefinition(parsed.value);
      setJsonError(null);
    } else {
      setJsonError(parsed.error);
    }
  };

  const onConnect = (c: Connection) => {
    const source = parseNodeId(c.source);
    if (source?.type !== 'step') return;
    const sourceKey = model.steps[source.index]?.key;
    const target = c.target === END_NODE_ID ? null : parseNodeId(c.target);
    const targetKey = c.target === END_NODE_ID ? END : model.steps[target?.index ?? -1]?.key;
    if (!sourceKey || !targetKey) return;
    const branch = (c.sourceHandle ?? 'next') as Branch;
    applyModel(connect(model, sourceKey, branch, targetKey));
  };

  const selectedId = selection
    ? selection.type === 'step'
      ? stepNodeId(selection.index)
      : triggerNodeId(selection.index)
    : null;

  const savedText = automation ? pretty(automation.definition) : null;
  const dirty =
    !automation ||
    name !== automation.name ||
    description !== automation.description ||
    pretty(definition) !== savedText;

  const onSave = () => {
    if (jsonError) return;
    save.mutate(
      {
        ...(automation ? { id: automation.id } : {}),
        input: { name: name.trim(), description, definition },
      },
      { onSuccess: (saved) => void navigate(`/workflows/${saved.id}`) },
    );
  };

  const afterIndex = selection?.type === 'step' ? selection.index : null;
  const run = execution.data;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-end">
          <Field label="Name" required>
            {(p) => (
              <Input
                {...p}
                value={name}
                maxLength={100}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Description">
            {(p) => (
              <Input
                {...p}
                value={description}
                disabled={!canEdit}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          {!automation ? (
            <Field label="Start from template">
              {(p) => (
                <Select
                  {...p}
                  value=""
                  disabled={!canEdit}
                  onChange={(e) => {
                    const template = TEMPLATES.find((t) => t.id === e.target.value);
                    if (!template) return;
                    setRaw(template.definition);
                    setSelection(null);
                    setName(template.label);
                  }}
                >
                  <option value="">Choose…</option>
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <SwitchField
              label={automation.enabled ? 'Enabled' : 'Disabled'}
              checked={automation.enabled}
              disabled={!canEdit || toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate({ id: automation.id, enabled })}
            />
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={onSave}
            disabled={!canEdit || Boolean(jsonError) || !name.trim() || !dirty}
            loading={save.isPending}
          >
            <Save /> {automation ? 'Save new version' : 'Create automation'}
          </Button>
          {automation && <Badge tone="electric">v{String(automation.version)}</Badge>}
          {automation && dirty && <Badge tone="warning">unsaved changes</Badge>}
          {issues.length > 0 && (
            <Badge tone="danger">
              {String(issues.length)} issue{issues.length === 1 ? '' : 's'}
            </Badge>
          )}
          <span className="flex-1" />
          <p className="text-xs text-ink-dim">Validated on save against the action catalog.</p>
        </div>
        {save.isError && (
          <Alert tone="danger" className="mt-3">
            {errorMessage(save.error)}
          </Alert>
        )}
        {!canEdit && (
          <Alert className="mt-3">Only workspace owners and admins can edit automations.</Alert>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Canvas"
          icon={<Workflow />}
          action={
            <Tabs value={view} onValueChange={(v) => setView(v as 'visual' | 'json')}>
              <TabsList aria-label="Editor view">
                <TabsTrigger value="visual">
                  <Workflow className="mr-1 inline size-3.5" aria-hidden />
                  Visual
                </TabsTrigger>
                <TabsTrigger value="json">
                  <Braces className="mr-1 inline size-3.5" aria-hidden />
                  JSON
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
        >
          {view === 'visual' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="secondary" disabled={!canEdit}>
                      <Plus /> Add step
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {STEP_KINDS.map(({ kind, label, hint, icon: Icon }) => (
                      <DropdownMenuItem
                        key={kind}
                        onSelect={() => {
                          const result = insertStep(model, kind, afterIndex);
                          applyModel(result.model, { type: 'step', index: result.index });
                        }}
                      >
                        <Icon />
                        <span className="flex flex-col">
                          <span className="text-ink">{label}</span>
                          <span className="text-xs text-ink-dim">{hint}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEdit || model.triggers.length >= 10}
                    >
                      <Plus /> Add trigger
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {TRIGGER_KINDS.map(({ kind, label, icon: Icon }) => (
                      <DropdownMenuItem
                        key={kind}
                        onSelect={() =>
                          applyModel(addTrigger(model, kind), {
                            type: 'trigger',
                            index: model.triggers.length,
                          })
                        }
                      >
                        <Icon /> {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {afterIndex !== null && (
                  <span className="text-xs text-ink-dim">
                    New steps go after{' '}
                    <span className="font-mono text-ink-muted">{model.steps[afterIndex]?.key}</span>
                  </span>
                )}
                <span className="flex-1" />
                {automation && (
                  <SwitchField
                    label="Show run"
                    checked={showRun}
                    disabled={!executions.data?.length && !runId}
                    onCheckedChange={setShowRun}
                  />
                )}
              </div>
              {jsonError && (
                <Alert tone="warning">
                  The JSON has an error, so the canvas shows the last valid version.
                </Alert>
              )}
              {showRun && activeRunId && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-base/50 px-3 py-2">
                  {executions.data?.some((e) => e.id === activeRunId) ? (
                    <Select
                      aria-label="Run to display"
                      value={activeRunId}
                      className="h-8 w-auto min-w-56 text-xs"
                      onChange={(e) => setRunId(e.target.value)}
                    >
                      {executions.data.map((e) => (
                        <option key={e.id} value={e.id}>
                          v{String(e.version)} · {statusLabel(e.status)} ·{' '}
                          {relativeTime(e.created_at)}
                          {e.dry_run ? ' · dry run' : ''}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="font-mono text-xs text-ink-muted">
                      {run?.dry_run ? 'Dry run' : 'Run'} {activeRunId.slice(0, 8)}
                    </span>
                  )}
                  {execution.isError && (
                    <span className="text-xs text-danger">{errorMessage(execution.error)}</span>
                  )}
                  {run && <StatusChip status={run.status} />}
                  {run && (
                    <Button asChild size="sm" variant="link">
                      <Link to={`/executions/${run.id}`}>
                        Details <ExternalLink />
                      </Link>
                    </Button>
                  )}
                  {run && automation && run.version !== automation.version && (
                    <span className="text-xs text-warning">
                      Ran on v{String(run.version)}; the canvas shows the current draft.
                    </span>
                  )}
                </div>
              )}
              <WorkflowCanvas
                nodes={graph.nodes}
                edges={graph.edges}
                selectedId={selectedId}
                editable={canEdit}
                className="h-[460px] lg:h-[600px]"
                onSelect={(id) => {
                  const parsed = id ? parseNodeId(id) : null;
                  setSelection(parsed);
                }}
                onConnect={onConnect}
              />
              {issues.length > 0 && (
                <div className="rounded-md border border-danger/25 bg-danger/[0.05] p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-danger">
                    <AlertTriangle className="size-3.5" aria-hidden /> Issues — the server will
                    reject these on save
                  </p>
                  <ul className="space-y-0.5 text-sm">
                    {issues.map((issue, i) => {
                      const target = selectionFor(issue, model);
                      return (
                        <li key={`${issue.target}:${String(i)}`}>
                          {target ? (
                            <button
                              type="button"
                              className="text-left text-ink-muted hover:text-ink hover:underline"
                              onClick={() => setSelection(target)}
                            >
                              <span className="font-mono text-xs text-ink-dim">{issue.target}</span>{' '}
                              {issue.message}
                            </button>
                          ) : (
                            <span className="text-ink-muted">{issue.message}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <Field
              label="Definition (JSON)"
              error={jsonError}
              help="Edits here update the canvas as soon as the JSON is valid."
            >
              {(p) => (
                <Textarea
                  {...p}
                  value={jsonText}
                  disabled={!canEdit}
                  spellCheck={false}
                  className="min-h-[560px] font-mono text-xs"
                  onChange={(e) => onJsonChange(e.target.value)}
                />
              )}
            </Field>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Inspector" icon={<GitBranch />}>
            {catalog.isError && (
              <Alert tone="warning" className="mb-3">
                Could not load the action catalog: {errorMessage(catalog.error)}
              </Alert>
            )}
            <StepInspector
              key={selectedId ?? 'none'}
              model={model}
              selection={selection}
              issues={selectionIssues(issues, selection, model)}
              catalog={catalog.data ?? []}
              canEdit={canEdit}
              onChange={applyModel}
            />
          </Panel>
          {automation && (
            <RunPanel
              workspaceId={workspaceId}
              automation={automation}
              onStarted={(id) => {
                setRunId(id);
                setShowRun(true);
                setView('visual');
              }}
            />
          )}
          {automation && (
            <VersionsPanel
              workspaceId={workspaceId}
              automation={automation}
              canEdit={canEdit}
              onLoad={(d) => {
                setRaw(d);
                setSelection(null);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
