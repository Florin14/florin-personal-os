import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  type Connection,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Flag,
  GitBranch,
  Hourglass,
  Loader2,
  Lock,
  Play,
  Plug,
  Radio,
  Repeat,
  ShieldCheck,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { memo, useMemo, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import type { Branch, TriggerKind } from './builderModel';
import {
  NODE_WIDTH,
  type FlowKind,
  type RunMark,
  type WorkflowEdge,
  type WorkflowNode,
} from './builderGraph';
import { FlowCanvas } from './FlowCanvas';

const KIND: Record<FlowKind, { label: string; icon: LucideIcon; accent: string; edge: string }> = {
  trigger: {
    label: 'Trigger',
    icon: Play,
    accent: 'border-cyan/40 bg-cyan/10 text-cyan',
    edge: 'border-cyan/45',
  },
  action: {
    label: 'Action',
    icon: Zap,
    accent: 'border-electric/40 bg-electric/10 text-electric-soft',
    edge: 'border-electric/45',
  },
  integration: {
    label: 'Integration',
    icon: Plug,
    accent: 'border-violet/40 bg-violet/10 text-violet',
    edge: 'border-violet/45',
  },
  condition: {
    label: 'Condition',
    icon: GitBranch,
    accent: 'border-warning/40 bg-warning/10 text-warning',
    edge: 'border-warning/45',
  },
  approval: {
    label: 'Approval',
    icon: ShieldCheck,
    accent: 'border-danger/40 bg-danger/10 text-danger',
    edge: 'border-danger/45',
  },
  notify: {
    label: 'Notify',
    icon: Bell,
    accent: 'border-success/40 bg-success/10 text-success',
    edge: 'border-success/45',
  },
  delay: {
    label: 'Delay',
    icon: Hourglass,
    accent: 'border-line-strong bg-white/[0.04] text-ink-muted',
    edge: 'border-line-strong',
  },
  end: {
    label: 'End',
    icon: Flag,
    accent: 'border-line-strong bg-white/[0.04] text-ink-dim',
    edge: 'border-line-strong',
  },
};

const TRIGGER_ICON: Record<TriggerKind, LucideIcon> = {
  manual: Play,
  cron: CalendarClock,
  interval: Repeat,
  event: Radio,
};

const RUN: Record<
  Exclude<RunMark, 'idle'>,
  { ring: string; icon: LucideIcon; text: string; label: string }
> = {
  succeeded: {
    ring: 'border-success/70 shadow-[0_0_22px_-8px_var(--color-success)]',
    icon: CheckCircle2,
    text: 'text-success',
    label: 'Succeeded',
  },
  failed: {
    ring: 'border-danger shadow-[0_0_24px_-6px_var(--color-danger)]',
    icon: XCircle,
    text: 'text-danger',
    label: 'Failed',
  },
  running: {
    ring: 'border-cyan shadow-glow-cyan',
    icon: Loader2,
    text: 'text-cyan',
    label: 'Running',
  },
  waiting: {
    ring: 'border-warning shadow-[0_0_24px_-6px_var(--color-warning)]',
    icon: Hourglass,
    text: 'text-warning',
    label: 'Waiting',
  },
  skipped: { ring: 'border-line-strong', icon: XCircle, text: 'text-ink-dim', label: 'Skipped' },
};

const handleClass = (editable: boolean) =>
  cn(
    'size-2.5! rounded-full! border! border-line-strong! bg-surface-3! transition-colors',
    editable ? 'hover:border-cyan! hover:bg-cyan/40!' : 'opacity-0! pointer-events-none!',
  );

function BranchHandle({
  id,
  left,
  label,
  editable,
}: {
  id: Branch;
  left: string;
  label: string;
  editable: boolean;
}) {
  // The edge label names the branch; the title helps when dragging a new connection.
  return (
    <Handle
      type="source"
      id={id}
      position={Position.Bottom}
      style={{ left }}
      title={`${label} branch`}
      className={handleClass(editable)}
      isConnectable={editable}
    />
  );
}

const WorkflowNodeView = memo(function WorkflowNodeView({
  data,
  selected,
}: NodeProps<WorkflowNode>) {
  const kind = KIND[data.kind];
  const Icon =
    data.kind === 'trigger' && data.triggerType ? TRIGGER_ICON[data.triggerType] : kind.icon;
  const run = data.run && data.run !== 'idle' ? RUN[data.run] : null;
  const RunIcon = run?.icon;
  const hasIssues = data.issues.length > 0;

  if (data.kind === 'end') {
    return (
      <div
        className={cn(
          'flex h-10 items-center justify-center gap-2 rounded-full border bg-surface-2/90 font-mono text-[11px] tracking-[0.18em] text-ink-muted uppercase',
          selected ? 'border-cyan' : run ? run.ring : 'border-line-strong',
          data.run === 'idle' && 'opacity-45',
        )}
        style={{ width: NODE_WIDTH }}
      >
        <Handle
          type="target"
          position={Position.Top}
          className={handleClass(data.editable)}
          isConnectable={data.editable}
        />
        <Flag className="size-3.5" aria-hidden /> End
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-[linear-gradient(180deg,rgb(22_32_58/0.96),rgb(10_15_28/0.96))] px-3 py-2.5 transition-[box-shadow,opacity,border-color] duration-200',
        selected
          ? 'border-cyan shadow-glow-cyan'
          : run
            ? run.ring
            : hasIssues
              ? 'border-danger/60'
              : cn(kind.edge, 'hover:shadow-glow'),
        data.kind === 'trigger' && 'rounded-xl',
        data.run === 'idle' && !selected && 'opacity-45',
        data.run === 'skipped' && 'opacity-60',
        data.unreachable && !run && 'border-dashed opacity-70',
      )}
      style={{ width: NODE_WIDTH }}
    >
      {data.kind !== 'trigger' && (
        <Handle
          type="target"
          position={Position.Top}
          className={handleClass(data.editable)}
          isConnectable={data.editable}
        />
      )}
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border',
            kind.accent,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] text-ink-dim uppercase">
            {data.kind === 'trigger' ? `${data.triggerType ?? ''} trigger` : kind.label}
            {data.current && (
              <span className="size-1.5 animate-pulse-soft rounded-full bg-cyan" aria-hidden />
            )}
          </p>
          <p className="truncate font-display text-[13.5px] leading-tight font-semibold text-ink">
            {data.title}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted" title={data.subtitle}>
            {data.subtitle}
          </p>
        </div>
        {run && RunIcon && (
          <span className={cn('mt-0.5', run.text)} title={run.label}>
            <RunIcon
              className={cn('size-4', data.run === 'running' && 'animate-spin')}
              aria-label={run.label}
            />
          </span>
        )}
      </div>
      {(Boolean(data.provider) || data.gated || hasIssues || data.unreachable) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {data.provider && (
            <span className="rounded-sm border border-violet/35 bg-violet/10 px-1.5 font-mono text-[9.5px] text-violet uppercase">
              {data.provider}
            </span>
          )}
          {data.gated && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-danger/35 bg-danger/10 px-1.5 font-mono text-[9.5px] text-danger uppercase">
              <Lock className="size-2.5" aria-hidden /> approval
            </span>
          )}
          {data.unreachable && (
            <span className="rounded-sm border border-line-strong px-1.5 font-mono text-[9.5px] text-ink-dim uppercase">
              unreachable
            </span>
          )}
          {hasIssues && (
            <span
              className="inline-flex items-center gap-1 rounded-sm border border-danger/40 bg-danger/10 px-1.5 font-mono text-[9.5px] text-danger"
              title={data.issues.join('\n')}
            >
              <AlertTriangle className="size-2.5" aria-hidden />
              {data.issues.length === 1 ? data.issues[0] : `${String(data.issues.length)} issues`}
            </span>
          )}
        </div>
      )}
      {data.kind === 'condition' ? (
        <>
          <BranchHandle id="true" left="30%" label="true" editable={data.editable} />
          <BranchHandle id="false" left="70%" label="false" editable={data.editable} />
        </>
      ) : (
        <Handle
          type="source"
          id="next"
          position={Position.Bottom}
          className={handleClass(data.editable)}
          isConnectable={data.editable && data.kind !== 'trigger'}
        />
      )}
    </div>
  );
});

const WorkflowEdgeView = memo(function WorkflowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
}: EdgeProps<WorkflowEdge>) {
  const reduceMotion = useReducedMotion();
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });
  const taken = data?.taken ?? false;
  const dim = (data?.overlay ?? false) && !taken;
  const isFalse = data?.branch === 'false';
  const color = taken
    ? 'var(--color-cyan)'
    : isFalse
      ? 'rgb(255 195 90 / 0.65)'
      : 'rgb(127 162 255 / 0.7)';
  return (
    <>
      {taken && <path d={path} fill="none" stroke={color} strokeOpacity={0.2} strokeWidth={7} />}
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: taken ? 2 : 1.5,
          strokeDasharray: isFalse ? '5 5' : undefined,
          opacity: dim ? 0.3 : 1,
        }}
      />
      {taken && !reduceMotion && (
        <circle
          r="3"
          fill="var(--color-cyan)"
          style={{ filter: 'drop-shadow(0 0 4px var(--color-cyan))' }}
        >
          <animateMotion dur="2s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {label && (
        <EdgeLabelRenderer>
          <span
            className={cn(
              'nodrag nopan pointer-events-none absolute rounded-sm border bg-base/90 px-1.5 py-px font-mono text-[9.5px] tracking-wide',
              isFalse ? 'border-warning/30 text-warning/80' : 'border-line text-ink-muted',
              dim && 'opacity-40',
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { workflow: WorkflowNodeView };
const edgeTypes = { workflow: WorkflowEdgeView };

/** Interactive workflow graph: select nodes to inspect, drag between handles to rewire. */
export function WorkflowCanvas({
  nodes,
  edges,
  selectedId,
  editable,
  onSelect,
  onConnect,
  className,
  overlay,
}: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedId: string | null;
  editable: boolean;
  onSelect: (id: string | null) => void;
  onConnect: (connection: Connection) => void;
  className?: string;
  overlay?: ReactNode;
}) {
  const withSelection = useMemo(
    () => nodes.map((n) => (n.id === selectedId ? { ...n, selected: true } : n)),
    [nodes, selectedId],
  );
  // Re-fit only when the graph's shape changes, not on every field edit.
  const fitKey = useMemo(
    () => `${nodes.map((n) => n.id).join(',')}|${edges.map((e) => e.id).join(',')}`,
    [nodes, edges],
  );
  return (
    <FlowCanvas<WorkflowNode, WorkflowEdge>
      label="Workflow canvas. Select a node to edit it in the inspector."
      className={className}
      nodes={withSelection}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitKey={fitKey}
      overlay={overlay}
      nodesDraggable={false}
      nodesConnectable={editable}
      elementsSelectable
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      onConnect={onConnect}
      isValidConnection={(c) => c.source !== c.target && !c.target.startsWith('trigger:')}
      deleteKeyCode={null}
    />
  );
}
