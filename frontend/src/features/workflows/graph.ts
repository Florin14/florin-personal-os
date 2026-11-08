import type { Edge, Node } from '@xyflow/react';

import type { Automation } from '@/api/types';

/** Minimal client-side view of a workflow definition (the server validates fully). */
export interface StepDef {
  key: string;
  type: string;
  title?: string;
  next?: string | null;
  on_true?: string | null;
  on_false?: string;
  action?: string;
  approval?: unknown;
}

export interface TriggerDef {
  key?: string;
  type: string;
  expression?: string;
  seconds?: number;
  event_type?: string;
  timezone?: string;
}

export interface DefinitionView {
  triggers: TriggerDef[];
  steps: StepDef[];
}

export const END = 'end';
const COLUMN = 260;
const ROW = 110;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Best-effort parse for previews; returns null when the shape is unusable. */
export function toDefinitionView(raw: unknown): DefinitionView | null {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return null;
  const steps = raw.steps.filter(
    (s): s is StepDef => isRecord(s) && typeof s.key === 'string' && typeof s.type === 'string',
  );
  const triggers = Array.isArray(raw.triggers)
    ? raw.triggers.filter((t): t is TriggerDef => isRecord(t) && typeof t.type === 'string')
    : [{ type: 'manual' }];
  return { steps, triggers };
}

/** Successors exactly as the engine computes them (default: next step in list). */
export function successors(
  view: DefinitionView,
  index: number,
): { target: string; label?: string }[] {
  const step = view.steps[index];
  if (!step) return [];
  const fallback = step.next ?? view.steps[index + 1]?.key ?? END;
  if (step.type === 'condition') {
    return [
      { target: step.on_true ?? fallback, label: 'true' },
      { target: step.on_false ?? END, label: 'false' },
    ];
  }
  return [{ target: fallback }];
}

export function describeTrigger(trigger: TriggerDef): string {
  switch (trigger.type) {
    case 'cron':
      return `Cron ${trigger.expression ?? ''} (${trigger.timezone ?? 'Europe/Bucharest'})`;
    case 'interval':
      return `Every ${String(Math.round((trigger.seconds ?? 0) / 60))} min`;
    case 'event':
      return `On ${trigger.event_type ?? 'event'}`;
    default:
      return 'Manual';
  }
}

export function describeStep(step: StepDef): string {
  if (step.type === 'action') return `${step.key}: ${step.action ?? 'action'}`;
  return `${step.key}: ${step.type}`;
}

/** Nodes/edges for a single workflow (Workflow Builder preview). */
export function workflowGraph(view: DefinitionView): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = view.triggers.map((t, i) => ({
    id: `trigger:${t.key ?? String(i)}`,
    position: { x: i * COLUMN, y: 0 },
    data: { label: describeTrigger(t) },
    type: 'input',
    className: 'pos-node pos-node--trigger',
  }));
  const edges: Edge[] = [];
  const first = view.steps[0];
  if (first) {
    for (const node of [...nodes]) {
      edges.push({ id: `${node.id}->${first.key}`, source: node.id, target: `step:${first.key}` });
    }
  }
  view.steps.forEach((step, index) => {
    nodes.push({
      id: `step:${step.key}`,
      position: { x: (index % 2) * 40, y: ROW * (index + 1) },
      data: { label: `${describeStep(step)}${step.approval ? ' 🔒' : ''}` },
      className: `pos-node pos-node--${step.type}`,
    });
    for (const { target, label } of successors(view, index)) {
      edges.push({
        id: `step:${step.key}->${target}:${label ?? ''}`,
        source: `step:${step.key}`,
        target: target === END ? 'end' : `step:${target}`,
        ...(label ? { label } : {}),
        animated: step.type === 'delay',
      });
    }
  });
  nodes.push({
    id: 'end',
    position: { x: 0, y: ROW * (view.steps.length + 1) },
    data: { label: 'End' },
    type: 'output',
    className: 'pos-node pos-node--end',
  });
  return { nodes, edges };
}

/** Workspace-wide network: triggers → automations → action namespaces. */
export function networkGraph(automations: Automation[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const namespaces = new Map<string, number>();
  let triggerRow = 0;

  automations.forEach((automation, row) => {
    const automationId = `automation:${automation.id}`;
    nodes.push({
      id: automationId,
      position: { x: COLUMN * 1.4, y: row * ROW },
      data: { label: automation.name, automationId: automation.id },
      className: `pos-node pos-node--automation${automation.enabled ? '' : ' pos-node--disabled'}`,
    });
    const view = toDefinitionView(automation.definition);
    for (const trigger of view?.triggers ?? []) {
      const triggerId = `trigger:${automation.id}:${trigger.key ?? trigger.type}`;
      nodes.push({
        id: triggerId,
        position: { x: 0, y: triggerRow * (ROW * 0.8) },
        data: { label: describeTrigger(trigger) },
        type: 'input',
        className: 'pos-node pos-node--trigger',
      });
      triggerRow += 1;
      edges.push({ id: `${triggerId}->${automationId}`, source: triggerId, target: automationId });
    }
    const used = new Set<string>();
    for (const step of view?.steps ?? []) {
      const namespace =
        step.type === 'action'
          ? ((step.action ?? 'core').split('.')[0] ?? 'core')
          : step.type === 'notify'
            ? 'notifications'
            : null;
      if (!namespace || used.has(namespace)) continue;
      used.add(namespace);
      if (!namespaces.has(namespace)) {
        namespaces.set(namespace, namespaces.size);
        nodes.push({
          id: `ns:${namespace}`,
          position: { x: COLUMN * 2.8, y: (namespaces.size - 1) * ROW },
          data: { label: namespace },
          type: 'output',
          className: 'pos-node pos-node--integration',
        });
      }
      edges.push({
        id: `${automationId}->ns:${namespace}`,
        source: automationId,
        target: `ns:${namespace}`,
        animated: automation.enabled,
      });
    }
  });
  return { nodes, edges };
}
