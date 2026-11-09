import '@xyflow/react/dist/style.css';

import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getStraightPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { memo, useMemo } from 'react';

import { cn } from '@/lib/cn';

import { MODULES, RELATIONSHIPS, type ModuleId } from './modules';
import type { ModuleState, ModuleStatus } from './useCommandData';

const STATUS_STYLE: Record<ModuleStatus, { dot: string; text: string; ring: string }> = {
  active: {
    dot: 'bg-cyan shadow-[0_0_10px_var(--color-cyan)]',
    text: 'text-cyan',
    ring: 'shadow-glow-cyan',
  },
  ready: {
    dot: 'bg-success shadow-[0_0_8px_var(--color-success)]',
    text: 'text-success',
    ring: '',
  },
  attention: {
    dot: 'bg-warning shadow-[0_0_10px_var(--color-warning)]',
    text: 'text-warning',
    ring: 'shadow-[0_0_0_1px_rgb(255_195_90/0.5),0_0_22px_-6px_var(--color-warning)]',
  },
  disconnected: { dot: 'bg-ink-dim', text: 'text-ink-muted', ring: '' },
  planned: { dot: 'bg-violet/60', text: 'text-violet', ring: '' },
};

type ModuleNodeData = { state: ModuleState; hub: boolean; dimmed: boolean };
type ModuleNodeType = Node<ModuleNodeData, 'module'>;
type NeuralEdgeData = { active: boolean; planned: boolean; highlighted: boolean; dimmed: boolean };
type NeuralEdgeType = Edge<NeuralEdgeData, 'neural'>;

const centerHandle = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  opacity: 0,
  pointerEvents: 'none' as const,
};

const ModuleNode = memo(function ModuleNode({ data, selected }: NodeProps<ModuleNodeType>) {
  const { state, hub, dimmed } = data;
  const { def } = state;
  const Icon = def.icon;
  const style = STATUS_STYLE[state.status];
  const planned = state.status === 'planned';
  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-[linear-gradient(180deg,rgb(22_32_58/0.95),rgb(10_15_28/0.95))] px-3.5 py-3 transition-[transform,box-shadow,opacity,border-color] duration-200 hover:-translate-y-0.5',
        hub ? 'w-[250px]' : 'w-[214px]',
        selected
          ? 'border-cyan shadow-glow-cyan'
          : 'border-line-strong hover:border-electric/60 hover:shadow-glow',
        !selected && style.ring,
        planned && 'border-dashed opacity-70',
        dimmed && 'opacity-35',
      )}
    >
      <Handle type="target" position={Position.Top} style={centerHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={centerHandle} isConnectable={false} />
      {hub && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-3 -z-10 animate-pulse-soft rounded-xl border border-cyan/25 bg-cyan/[0.04] shadow-[0_0_60px_-10px_var(--color-cyan)]"
        />
      )}
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md border',
            def.accent === 'cyan' && 'border-cyan/40 bg-cyan/10 text-cyan',
            def.accent === 'electric' && 'border-electric/40 bg-electric/10 text-electric-soft',
            def.accent === 'violet' && 'border-violet/35 bg-violet/10 text-violet',
          )}
        >
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-[14px] leading-tight font-semibold text-ink">
            {def.label}
          </p>
          <p
            className={cn(
              'mt-0.5 flex items-center gap-1.5 font-mono text-[10px] tracking-wide uppercase',
              style.text,
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                style.dot,
                state.status === 'active' && 'animate-pulse-soft',
              )}
            />
            {state.statusLabel}
          </p>
        </div>
      </div>
      <dl className="mt-2.5 space-y-1 border-t border-line pt-2">
        {state.metrics.slice(0, hub ? 4 : 2).map((m) => (
          <div key={m.label} className="flex items-baseline justify-between gap-2 text-[12px]">
            <dt className="truncate text-ink-dim">{m.label}</dt>
            <dd className="truncate font-mono text-ink-muted tabular-nums">{m.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});

const NeuralEdge = memo(function NeuralEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  data,
}: EdgeProps<NeuralEdgeType>) {
  const reduceMotion = useReducedMotion();
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const active = data?.active ?? false;
  const planned = data?.planned ?? false;
  const highlighted = data?.highlighted ?? false;
  const dimmed = data?.dimmed ?? false;
  const color = planned
    ? 'rgb(155 123 255 / 0.45)'
    : active || highlighted
      ? 'var(--color-cyan)'
      : 'rgb(127 162 255 / 0.75)';
  return (
    <>
      {!planned && (
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeOpacity={dimmed ? 0.05 : 0.18}
          strokeWidth={highlighted ? 8 : 6}
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: highlighted ? 2.2 : 1.6,
          strokeDasharray: planned ? '3 6' : active ? '6 6' : undefined,
          opacity: dimmed ? 0.15 : 1,
        }}
        className={active && !reduceMotion ? 'animate-flow' : undefined}
      />
      {active && !reduceMotion && !dimmed && (
        <circle
          r="3"
          fill="var(--color-cyan)"
          style={{ filter: 'drop-shadow(0 0 4px var(--color-cyan))' }}
        >
          <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {label && !dimmed && (
        <EdgeLabelRenderer>
          <span
            className={cn(
              'nodrag nopan pointer-events-none absolute rounded-sm border border-line bg-base/90 px-1.5 py-px font-mono text-[9.5px] tracking-wide',
              planned ? 'text-violet/70' : 'text-ink-muted',
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

const nodeTypes = { module: ModuleNode };
const edgeTypes = { neural: NeuralEdge };

function ZoomReadout() {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-10 rounded-sm border border-line bg-base/80 px-2 py-1 font-mono text-[10px] text-ink-dim">
      ZOOM {Math.round(zoom * 100)}%
    </div>
  );
}

function Canvas({
  states,
  selected,
  onSelect,
}: {
  states: Map<ModuleId, ModuleState>;
  selected: ModuleId | null;
  onSelect: (id: ModuleId | null) => void;
}) {
  const related = useMemo(() => {
    if (!selected) return null;
    const ids = new Set<ModuleId>([selected]);
    for (const r of RELATIONSHIPS) {
      if (r.source === selected) ids.add(r.target);
      if (r.target === selected) ids.add(r.source);
    }
    return ids;
  }, [selected]);

  const nodes = useMemo<ModuleNodeType[]>(
    () =>
      MODULES.flatMap((def) => {
        const state = states.get(def.id);
        if (!state) return [];
        return [
          {
            id: def.id,
            type: 'module' as const,
            position: {
              x: def.position.x - (def.id === 'engine' ? 125 : 107),
              y: def.position.y - 60,
            },
            data: {
              state,
              hub: def.id === 'engine',
              dimmed: related ? !related.has(def.id) : false,
            },
            selected: def.id === selected,
            ariaLabel: `${def.label}: ${state.statusLabel}`,
          },
        ];
      }),
    [states, selected, related],
  );

  const edges = useMemo<NeuralEdgeType[]>(
    () =>
      RELATIONSHIPS.map((r) => {
        const source = states.get(r.source);
        const target = states.get(r.target);
        const planned = !source?.def.available || !target?.def.available;
        const active = !planned && (source.running > 0 || target.running > 0);
        const highlighted = selected !== null && (r.source === selected || r.target === selected);
        return {
          id: `${r.source}-${r.target}`,
          source: r.source,
          target: r.target,
          type: 'neural' as const,
          label: r.label,
          data: { active, planned, highlighted, dimmed: selected !== null && !highlighted },
        };
      }),
    [states, selected],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.35}
      maxZoom={1.8}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      onNodeClick={(_, node) => onSelect(node.id as ModuleId)}
      onPaneClick={() => onSelect(null)}
      onSelectionChange={({ nodes: picked }) => {
        const first = picked[0];
        if (first && first.id !== selected) onSelect(first.id as ModuleId);
      }}
      colorMode="dark"
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={22} size={1.2} color="rgb(120 150 255 / 0.18)" />
      <Controls showInteractive={false} position="bottom-left" aria-label="Canvas controls" />
      <ZoomReadout />
    </ReactFlow>
  );
}

/** The signature neural map of Personal OS modules and their relationships. */
export function NeuralCanvas(props: {
  states: Map<ModuleId, ModuleState>;
  selected: ModuleId | null;
  onSelect: (id: ModuleId | null) => void;
}) {
  return (
    <div
      className="relative h-full min-h-[460px] w-full overflow-hidden rounded-lg border border-line bg-[radial-gradient(ellipse_at_center,rgb(79_125_255/0.12),transparent_65%)]"
      role="group"
      aria-label="Neural map of Personal OS modules. Use Tab to focus a module and Enter to select it."
    >
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
