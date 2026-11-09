import '@xyflow/react/dist/style.css';

import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type ReactFlowProps,
} from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Re-fits the viewport whenever `fitKey` changes (e.g. a node was added or removed). */
function AutoFit({ fitKey }: { fitKey: string }) {
  const { fitView } = useReactFlow();
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.18, duration: reduceMotion ? 0 : 280 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitKey, fitView, reduceMotion]);
  return null;
}

/** Themed React Flow canvas shared by the Workflow Builder and the Automation Network. */
export function FlowCanvas<N extends Node, E extends Edge>({
  label,
  className,
  fitKey,
  overlay,
  ...flowProps
}: ReactFlowProps<N, E> & {
  label: string;
  className?: string;
  fitKey?: string;
  overlay?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'relative h-[520px] w-full overflow-hidden rounded-lg border border-line bg-[radial-gradient(ellipse_at_top,rgb(79_125_255/0.10),transparent_60%)]',
        className,
      )}
    >
      <ReactFlowProvider>
        <ReactFlow<N, E>
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.3}
          maxZoom={1.75}
          colorMode="dark"
          edgesFocusable={false}
          {...flowProps}
        >
          <Background gap={22} size={1.2} color="rgb(120 150 255 / 0.16)" />
          <Controls showInteractive={false} position="bottom-left" aria-label="Canvas controls" />
          {fitKey !== undefined && <AutoFit fitKey={fitKey} />}
        </ReactFlow>
      </ReactFlowProvider>
      {overlay}
    </div>
  );
}
