import {
  BaseEdge,
  getBezierPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react';
import {
  Boxes,
  CalendarClock,
  Play,
  Plug,
  Plus,
  Radio,
  Repeat,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAutomations } from '@/api/automation';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Metric, Panel } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { cn } from '@/lib/cn';

import type { TriggerKind } from './builderModel';
import { FlowCanvas } from './FlowCanvas';
import { networkGraph, type NetworkEdge, type NetworkNode } from './graph';

const TRIGGER_ICON: Record<TriggerKind, LucideIcon> = {
  manual: Play,
  cron: CalendarClock,
  interval: Repeat,
  event: Radio,
};

const hidden = { opacity: 0, pointerEvents: 'none' as const };

const NetworkNodeView = memo(function NetworkNodeView({ data }: NodeProps<NetworkNode>) {
  const Icon =
    data.kind === 'trigger'
      ? TRIGGER_ICON[data.triggerType ?? 'manual']
      : data.kind === 'automation'
        ? Workflow
        : data.provider
          ? Plug
          : Boxes;
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border bg-[linear-gradient(180deg,rgb(22_32_58/0.95),rgb(10_15_28/0.95))] px-3 py-2 transition-[box-shadow,border-color]',
        data.kind === 'automation'
          ? 'w-[230px] cursor-pointer border-electric/50 hover:border-electric hover:shadow-glow'
          : 'w-[200px] border-line-strong',
        data.kind === 'trigger' && 'rounded-xl',
        data.kind === 'system' && data.provider && 'border-violet/40',
        !data.enabled && 'opacity-45',
      )}
    >
      {data.kind !== 'trigger' && (
        <Handle type="target" position={Position.Left} style={hidden} isConnectable={false} />
      )}
      {data.kind !== 'system' && (
        <Handle type="source" position={Position.Right} style={hidden} isConnectable={false} />
      )}
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md border',
          data.kind === 'trigger' && 'border-cyan/40 bg-cyan/10 text-cyan',
          data.kind === 'automation' && 'border-electric/40 bg-electric/10 text-electric-soft',
          data.kind === 'system' &&
            (data.provider
              ? 'border-violet/40 bg-violet/10 text-violet'
              : 'border-line-strong bg-white/[0.04] text-ink-muted'),
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'truncate text-[13px] leading-tight text-ink',
            data.kind === 'automation' ? 'font-display font-semibold' : 'font-medium',
          )}
        >
          {data.label}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10.5px] text-ink-dim" title={data.detail}>
          {data.detail}
        </p>
      </div>
    </div>
  );
});

const NetworkEdgeView = memo(function NetworkEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<NetworkEdge>) {
  const reduceMotion = useReducedMotion();
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const active = data?.active ?? false;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: active ? 'rgb(127 162 255 / 0.75)' : 'rgb(120 150 255 / 0.25)',
          strokeWidth: 1.5,
          strokeDasharray: active ? undefined : '4 6',
        }}
      />
      {active && !reduceMotion && (
        <circle
          r="2.5"
          fill="var(--color-cyan)"
          style={{ filter: 'drop-shadow(0 0 4px var(--color-cyan))' }}
        >
          <animateMotion dur="3s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
});

const nodeTypes = { network: NetworkNodeView };
const edgeTypes = { network: NetworkEdgeView };

/** Read-only map of how triggers, automations and the systems they act on connect. */
export default function NetworkPage() {
  const workspace = useCurrentWorkspace();
  const automations = useAutomations(workspace?.id);
  const navigate = useNavigate();
  const graph = useMemo(() => networkGraph(automations.data ?? []), [automations.data]);
  const enabled = (automations.data ?? []).filter((a) => a.enabled).length;
  const count = (kind: string) => graph.nodes.filter((n) => n.data.kind === kind).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Automation Network"
        subtitle="Triggers on the left, automations in the middle, the systems they act on to the right."
        actions={
          <Button asChild variant="primary">
            <Link to="/workflows/new">
              <Plus /> New automation
            </Link>
          </Button>
        }
      />
      {!workspace ? (
        <EmptyState title="No workspace selected" />
      ) : automations.isPending ? (
        <LoadingState />
      ) : automations.isError ? (
        <ErrorState error={automations.error} onRetry={() => void automations.refetch()} />
      ) : automations.data.length === 0 ? (
        <Panel>
          <EmptyState
            title="No automations yet"
            description="Create your first automation in the Workflow Builder."
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Automations" value={automations.data.length} />
            <Metric label="Enabled" value={enabled} tone={enabled > 0 ? 'success' : 'neutral'} />
            <Metric label="Triggers" value={count('trigger')} />
            <Metric label="Connected systems" value={count('system')} />
          </div>
          <FlowCanvas<NetworkNode, NetworkEdge>
            label="Automation network graph. Select an automation to open it in the Workflow Builder."
            className="h-[480px] lg:h-[600px]"
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, node) => {
              if (node.data.automationId) void navigate(`/workflows/${node.data.automationId}`);
            }}
          />
          <p className="text-sm text-ink-dim">
            Select an automation node to open it in the Workflow Builder. Dimmed nodes are disabled;
            animated links carry live automations.
          </p>
        </>
      )}
    </div>
  );
}
