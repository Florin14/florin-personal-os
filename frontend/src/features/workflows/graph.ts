import type { Edge, Node } from '@xyflow/react';

import type { Automation } from '@/api/types';

import { describeTrigger, INTEGRATION_ACTIONS, toModel, type TriggerKind } from './builderModel';

export type NetworkKind = 'trigger' | 'automation' | 'system';

export interface NetworkNodeData extends Record<string, unknown> {
  kind: NetworkKind;
  label: string;
  detail: string;
  enabled: boolean;
  automationId?: string;
  triggerType?: TriggerKind;
  /** Provider behind an integration namespace (e.g. Oblio), if any. */
  provider?: string;
}

export interface NetworkEdgeData extends Record<string, unknown> {
  active: boolean;
}

export type NetworkNode = Node<NetworkNodeData, 'network'>;
export type NetworkEdge = Edge<NetworkEdgeData, 'network'>;

const COLUMN = 340;
const TRIGGER_ROW = 84;
const ROW = 120;

/** Workspace-wide network: triggers → automations → the systems their steps act on. */
export function networkGraph(automations: Automation[]): {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
} {
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];
  const systems = new Map<string, number>();
  let triggerRow = 0;
  const triggerRows: number[] = [];

  automations.forEach((automation, row) => {
    const automationId = `automation:${automation.id}`;
    const model = toModel(automation.definition);
    const firstTriggerRow = triggerRow;
    for (const trigger of model.triggers) {
      const triggerId = `trigger:${automation.id}:${trigger.key ?? trigger.type}`;
      nodes.push({
        id: triggerId,
        type: 'network',
        position: { x: 0, y: triggerRow * TRIGGER_ROW },
        data: {
          kind: 'trigger',
          label: trigger.type === 'manual' ? 'Manual' : trigger.type,
          detail: describeTrigger(trigger),
          enabled: automation.enabled,
          triggerType: trigger.type,
        },
      });
      triggerRow += 1;
      edges.push({
        id: `${triggerId}->${automationId}`,
        source: triggerId,
        target: automationId,
        type: 'network',
        data: { active: automation.enabled },
      });
    }
    triggerRows.push((firstTriggerRow + Math.max(triggerRow - 1, firstTriggerRow)) / 2);

    nodes.push({
      id: automationId,
      type: 'network',
      position: { x: COLUMN, y: Math.max(row * ROW, (triggerRows[row] ?? 0) * TRIGGER_ROW) },
      data: {
        kind: 'automation',
        label: automation.name,
        detail: `v${String(automation.version)} · ${String(model.steps.length)} steps`,
        enabled: automation.enabled,
        automationId: automation.id,
      },
      ariaLabel: `Automation ${automation.name}${automation.enabled ? '' : ' (disabled)'}`,
    });

    const used = new Set<string>();
    const touched = model.steps.flatMap((step) => {
      if (step.type === 'action') {
        const namespace = (step.action ?? 'core').split('.')[0] ?? 'core';
        return step.approval ? ['approvals', namespace] : [namespace];
      }
      if (step.type === 'notify') return ['notifications'];
      if (step.type === 'approval') return ['approvals'];
      return [];
    });
    for (const namespace of touched) {
      if (used.has(namespace)) continue;
      used.add(namespace);
      if (!systems.has(namespace)) {
        systems.set(namespace, systems.size);
        const provider = INTEGRATION_ACTIONS[namespace];
        nodes.push({
          id: `ns:${namespace}`,
          type: 'network',
          position: { x: COLUMN * 2, y: (systems.size - 1) * ROW },
          data: {
            kind: 'system',
            label: namespace,
            detail: provider ? `via ${provider}` : 'built-in',
            enabled: true,
            ...(provider ? { provider } : {}),
          },
        });
      }
      edges.push({
        id: `${automationId}->ns:${namespace}`,
        source: automationId,
        target: `ns:${namespace}`,
        type: 'network',
        data: { active: automation.enabled },
      });
    }
  });
  return { nodes, edges };
}
