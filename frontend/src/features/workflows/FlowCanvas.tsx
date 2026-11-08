import '@xyflow/react/dist/style.css';

import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';

/** Themed, read-only React Flow canvas used by the network view and builder preview. */
export function FlowCanvas({
  nodes,
  edges,
  height = 520,
  label,
  onNodeClick,
}: {
  nodes: Node[];
  edges: Edge[];
  height?: number;
  label: string;
  onNodeClick?: (node: Node) => void;
}) {
  const { palette } = useTheme();
  const node = {
    borderRadius: 10,
    border: `1px solid ${palette.divider}`,
    background: palette.background.paper,
    color: palette.text.primary,
    fontSize: 13,
    padding: '8px 12px',
  };
  return (
    <Box
      role="img"
      aria-label={label}
      sx={{
        height,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        overflow: 'hidden',
        '& .react-flow__node': node,
        '& .pos-node--trigger': { borderColor: palette.secondary.main },
        '& .pos-node--automation': {
          borderColor: palette.primary.main,
          background: alpha(palette.primary.main, 0.12),
          fontWeight: 600,
          cursor: onNodeClick ? 'pointer' : 'default',
        },
        '& .pos-node--disabled': { opacity: 0.5 },
        '& .pos-node--integration': { borderStyle: 'dashed' },
        '& .pos-node--condition': { borderColor: palette.warning.main },
        '& .pos-node--approval': { borderColor: palette.error.main },
        '& .pos-node--end': { opacity: 0.7 },
        '& .react-flow__edge-path': { stroke: alpha(palette.primary.main, 0.7) },
        '& .react-flow__edge-text': { fill: palette.text.primary },
        '& .react-flow__edge-textbg': { fill: palette.background.paper },
        '& .react-flow__controls button': {
          background: palette.background.paper,
          color: palette.text.primary,
          borderColor: palette.divider,
        },
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={Boolean(onNodeClick)}
        colorMode={palette.mode}
        {...(onNodeClick ? { onNodeClick: (_: unknown, n: Node) => onNodeClick(n) } : {})}
      >
        <Background gap={24} color={alpha(palette.text.primary, 0.08)} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </Box>
  );
}
