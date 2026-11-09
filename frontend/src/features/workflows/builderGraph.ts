import type { Edge, Node } from '@xyflow/react';

import type { ExecutionStatus } from '@/api/types';

import {
  describeStep,
  describeTrigger,
  END,
  integrationFor,
  successors,
  type Branch,
  type Issue,
  type StepModel,
  type TriggerKind,
  type WorkflowModel,
} from './builderModel';

export type FlowKind =
  'trigger' | 'action' | 'integration' | 'condition' | 'approval' | 'notify' | 'delay' | 'end';

/** Run status of a node in the execution overlay (`idle` = not reached in that run). */
export type RunMark = 'succeeded' | 'failed' | 'running' | 'waiting' | 'skipped' | 'idle';

export interface WorkflowNodeData extends Record<string, unknown> {
  kind: FlowKind;
  title: string;
  subtitle: string;
  stepKey?: string;
  triggerType?: TriggerKind;
  provider?: string | null;
  gated: boolean;
  issues: string[];
  unreachable: boolean;
  run?: RunMark;
  current: boolean;
  editable: boolean;
}

export interface WorkflowEdgeData extends Record<string, unknown> {
  branch: Branch | 'trigger';
  taken: boolean;
  overlay: boolean;
}

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;
export type WorkflowEdge = Edge<WorkflowEdgeData, 'workflow'>;

/** Subset of an execution the overlay needs. */
export interface RunOverlay {
  status: ExecutionStatus;
  triggerKey: string;
  currentStepKey: string | null;
  steps: { step_key: string; status: string }[];
}

export const NODE_WIDTH = 236;
const COLUMN = 276;
const ROW = 150;

export const stepNodeId = (index: number) => `step:${String(index)}`;
export const triggerNodeId = (index: number) => `trigger:${String(index)}`;
export const END_NODE_ID = 'end';

export function parseNodeId(id: string): { type: 'step' | 'trigger'; index: number } | null {
  const [type, raw] = id.split(':');
  const index = Number(raw);
  if ((type !== 'step' && type !== 'trigger') || !Number.isInteger(index)) return null;
  return { type, index };
}

function kindOf(step: StepModel): FlowKind {
  if (step.type === 'action') return integrationFor(step.action) ? 'integration' : 'action';
  return step.type;
}

function markFor(status: string | undefined): RunMark {
  switch (status) {
    case undefined:
      return 'idle';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'cancelled':
      return 'skipped';
    case 'waiting_approval':
    case 'waiting_delay':
    case 'waiting':
      return 'waiting';
    default:
      return 'running';
  }
}

/**
 * Longest-path depth from the first step, so every edge points downwards.
 * Steps the start cannot reach keep their list position as depth.
 */
function depths(model: WorkflowModel, indexOf: Map<string, number>): number[] {
  const n = model.steps.length;
  const depth: number[] = model.steps.map((_, i) => (i === 0 ? 0 : -1));
  for (let pass = 0; pass < n; pass += 1) {
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      const d = depth[i] ?? -1;
      if (d < 0) continue;
      for (const { target } of successors(model, i)) {
        const j = indexOf.get(target);
        if (j === undefined || j === i || d + 1 > n) continue;
        if ((depth[j] ?? -1) < d + 1) {
          depth[j] = d + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return depth;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/**
 * Horizontal centers per step: each node sits under the average of its parents (true branches
 * lean left, false branches right), then rows are spread so nodes never overlap. This keeps
 * long edges from running straight through unrelated nodes.
 */
function layoutColumns(
  model: WorkflowModel,
  indexOf: Map<string, number>,
  depth: number[],
): { steps: number[]; end: number } {
  const lean = COLUMN / 2;
  const parents: { from: number; offset: number }[][] = model.steps.map(() => []);
  const endParents: number[] = [];
  model.steps.forEach((_, i) => {
    for (const { target, label } of successors(model, i)) {
      if (target === END) {
        endParents.push(i);
        continue;
      }
      const j = indexOf.get(target);
      if (j === undefined || (depth[j] ?? 0) <= (depth[i] ?? 0)) continue;
      const offset = label === 'true' ? -lean : label === 'false' ? lean : 0;
      parents[j]?.push({ from: i, offset });
    }
  });

  const x: number[] = model.steps.map(() => 0);
  const rows = new Map<number, number[]>();
  depth.forEach((d, i) => rows.set(d, [...(rows.get(d) ?? []), i]));
  for (const d of [...rows.keys()].sort((a, b) => a - b)) {
    const row = (rows.get(d) ?? []).map((i) => ({
      i,
      desired: mean((parents[i] ?? []).map((p) => (x[p.from] ?? 0) + p.offset)),
    }));
    row.sort((a, b) => a.desired - b.desired || a.i - b.i);
    const placed: number[] = [];
    row.forEach((node, k) => {
      const previous = placed[k - 1];
      placed.push(
        previous === undefined ? node.desired : Math.max(node.desired, previous + COLUMN),
      );
    });
    const shift = mean(row.map((n) => n.desired)) - mean(placed);
    row.forEach((node, k) => {
      x[node.i] = (placed[k] ?? 0) + shift;
    });
  }
  return { steps: x, end: mean(endParents.map((i) => x[i] ?? 0)) };
}

/** Nodes and edges for the visual builder, optionally overlaid with an execution's state. */
export function buildWorkflowGraph(
  model: WorkflowModel,
  options: { issues: Issue[]; overlay?: RunOverlay | null; editable: boolean },
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const { issues, overlay, editable } = options;
  const indexOf = new Map<string, number>();
  model.steps.forEach((s, i) => {
    if (!indexOf.has(s.key)) indexOf.set(s.key, i);
  });
  const depth = depths(model, indexOf);
  const reachable = depth.map((d) => d >= 0);
  const finalDepth = depth.map((d, i) => (d >= 0 ? d : i));
  const lastRow = Math.max(-1, ...finalDepth) + 1;

  const centers = layoutColumns(model, indexOf, finalDepth);
  const firstX = centers.steps[0] ?? 0;
  const left = (center: number) => center - NODE_WIDTH / 2;

  const runs = new Map((overlay?.steps ?? []).map((s) => [s.step_key, s.status]));
  const issuesFor = (target: string) =>
    issues.filter((issue) => issue.target === target).map((issue) => issue.message);

  const fired = (index: number) => {
    const t = model.triggers[index];
    return Boolean(overlay && t && (t.key ?? t.type) === overlay.triggerKey);
  };

  const nodes: WorkflowNode[] = model.triggers.map((t, i) => ({
    id: triggerNodeId(i),
    type: 'workflow',
    position: { x: left(firstX + (i - (model.triggers.length - 1) / 2) * COLUMN), y: 0 },
    data: {
      kind: 'trigger',
      triggerType: t.type,
      title: t.key ?? t.type,
      subtitle: describeTrigger(t),
      gated: false,
      issues: issuesFor(triggerNodeId(i)),
      unreachable: false,
      current: false,
      editable,
      ...(overlay ? { run: fired(i) ? ('succeeded' as const) : ('idle' as const) } : {}),
    },
    ariaLabel: `Trigger ${t.key ?? t.type}: ${describeTrigger(t)}`,
  }));

  model.steps.forEach((step, i) => {
    const d = finalDepth[i] ?? i;
    const stepIssues = issuesFor(`step:${step.key}`);
    nodes.push({
      id: stepNodeId(i),
      type: 'workflow',
      position: { x: left(centers.steps[i] ?? 0), y: ROW * (d + 1) },
      data: {
        kind: kindOf(step),
        stepKey: step.key,
        title: step.title?.trim() || step.key,
        subtitle: describeStep(step),
        provider: step.type === 'action' ? integrationFor(step.action) : null,
        gated: step.type === 'action' && Boolean(step.approval),
        issues: stepIssues,
        unreachable: !reachable[i],
        current: overlay?.currentStepKey === step.key,
        editable,
        ...(overlay ? { run: markFor(runs.get(step.key)) } : {}),
      },
      ariaLabel: `${step.type} step ${step.key}: ${describeStep(step)}${
        stepIssues.length ? `, ${String(stepIssues.length)} issue(s)` : ''
      }`,
    });
  });

  const finished = overlay?.status === 'succeeded';
  nodes.push({
    id: END_NODE_ID,
    type: 'workflow',
    position: { x: left(centers.end), y: ROW * (lastRow + 1) },
    data: {
      kind: 'end',
      title: 'End',
      subtitle: 'workflow complete',
      gated: false,
      issues: [],
      unreachable: false,
      current: false,
      editable,
      ...(overlay ? { run: finished ? ('succeeded' as const) : ('idle' as const) } : {}),
    },
    ariaLabel: 'End of workflow',
  });

  const edges: WorkflowEdge[] = [];
  const first = model.steps[0];
  if (first) {
    model.triggers.forEach((_, i) => {
      edges.push({
        id: `${triggerNodeId(i)}->${stepNodeId(0)}`,
        source: triggerNodeId(i),
        target: stepNodeId(0),
        sourceHandle: 'next',
        type: 'workflow',
        data: { branch: 'trigger', taken: fired(i) && runs.has(first.key), overlay: !!overlay },
      });
    });
  }
  model.steps.forEach((step, i) => {
    const sourceDone = runs.get(step.key) === 'succeeded';
    for (const { target, label } of successors(model, i)) {
      const j = indexOf.get(target);
      if (target !== END && j === undefined) continue; // reported as an issue instead
      const targetId = target === END ? END_NODE_ID : stepNodeId(j ?? 0);
      const branch: Branch = label === 'true' ? 'true' : label === 'false' ? 'false' : 'next';
      const taken = sourceDone && (target === END ? finished : runs.has(target));
      edges.push({
        id: `${stepNodeId(i)}:${branch}->${targetId}`,
        source: stepNodeId(i),
        target: targetId,
        sourceHandle: branch,
        type: 'workflow',
        ...(label ? { label } : {}),
        data: { branch, taken, overlay: !!overlay },
      });
    }
  });
  return { nodes, edges };
}
