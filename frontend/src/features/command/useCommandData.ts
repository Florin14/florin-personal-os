import { useApprovals } from '@/api/approvals';
import { isActive, useAutomations, useExecutions } from '@/api/automation';
import { useConnections } from '@/api/integrations';
import { useInvoices } from '@/api/invoicing';
import type { Automation, Execution } from '@/api/types';
import { formatMoney, sumMoney } from '@/components/data/format';
import { useCalendar, useDocuments, useExpenseSummary, useTasks } from '@/api/workspaceData';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

import { MODULES, type ModuleDef, type ModuleId } from './modules';

export type ModuleStatus = 'active' | 'ready' | 'attention' | 'disconnected' | 'planned';

export interface ModuleState {
  def: ModuleDef;
  status: ModuleStatus;
  statusLabel: string;
  automations: Automation[];
  running: number;
  failed: number;
  metrics: { label: string; value: string }[];
}

const STATUS_LABEL: Record<ModuleStatus, string> = {
  active: 'Running',
  ready: 'Ready',
  attention: 'Needs attention',
  disconnected: 'Not connected',
  planned: 'Planned',
};

function actionsOf(automation: Automation): string[] {
  const steps =
    (automation.definition as { steps?: { type?: string; action?: string }[] }).steps ?? [];
  return steps.filter((s) => s.type === 'action' && s.action).map((s) => String(s.action));
}

function belongsTo(def: ModuleDef, automation: Automation): boolean {
  if (def.id === 'engine') return true;
  return actionsOf(automation).some((a) => def.actionPrefixes.some((p) => a.startsWith(p)));
}

/** Aggregates real backend data into per-module neural-node state. */
export function useCommandData() {
  const workspace = useCurrentWorkspace();
  const wsId = workspace?.id;
  const year = new Date().getFullYear();
  const automations = useAutomations(wsId);
  const executions = useExecutions(wsId);
  const approvals = useApprovals('pending');
  const connections = useConnections();
  const invoices = useInvoices(wsId);
  const documents = useDocuments(wsId);
  const expenses = useExpenseSummary(wsId, year);
  const tasks = useTasks(wsId, false);
  const calendar = useCalendar(wsId);

  const connection = (provider: string) =>
    connections.data?.find(
      (c) => c.provider === provider && (c.workspace_id === wsId || c.workspace_id === null),
    );

  const recent: Execution[] = executions.data ?? [];
  const allAutomations = automations.data ?? [];

  const states = new Map<ModuleId, ModuleState>();
  for (const def of MODULES) {
    const owned = allAutomations.filter((a) => belongsTo(def, a));
    const ids = new Set(owned.map((a) => a.id));
    const mine = recent.filter((e) => ids.has(e.automation_id));
    const running = mine.filter((e) => isActive(e.status)).length;
    const failed = mine.filter((e) => e.status === 'failed').length;
    const metrics: { label: string; value: string }[] = [];
    let status: ModuleStatus = 'ready';

    if (!def.available) {
      status = 'planned';
      metrics.push({ label: 'Available in', value: `Phase ${String(def.phase)}` });
    } else {
      const missing = def.providers.filter((p) => !connection(p));
      const broken = def.providers.some((p) => connection(p)?.status === 'error');
      if (def.id === 'business' || def.id === 'calendar') {
        if (missing.length) status = 'disconnected';
      }
      if (broken || failed > 0) status = 'attention';
      else if (running > 0) status = 'active';

      if (def.id === 'engine') {
        metrics.push(
          { label: 'Automations', value: String(allAutomations.length) },
          { label: 'Enabled', value: String(allAutomations.filter((a) => a.enabled).length) },
          { label: 'Pending approvals', value: String(approvals.data?.length ?? 0) },
        );
      }
      if (def.id === 'business') {
        const issued = (invoices.data ?? []).filter((i) => i.status === 'issued');
        const pending = (invoices.data ?? []).filter((i) => i.status === 'pending').length;
        metrics.push(
          { label: 'Invoices issued', value: String(issued.length) },
          { label: 'Oblio', value: connection('oblio')?.status ?? 'not connected' },
        );
        if (pending) metrics.push({ label: 'Unverified', value: String(pending) });
        if (pending) status = 'attention';
      }
      if (def.id === 'finance') {
        const inbox = (documents.data ?? []).filter((d) => d.status === 'inbox').length;
        const byCurrency = new Map<string, string[]>();
        for (const row of expenses.data ?? []) {
          byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), row.total]);
        }
        metrics.push(
          { label: 'Documents in inbox', value: String(inbox) },
          {
            label: `Expenses ${String(year)}`,
            value: byCurrency.size
              ? [...byCurrency].map(([c, v]) => formatMoney(sumMoney(v), c)).join(' · ')
              : '—',
          },
        );
      }
      if (def.id === 'calendar') {
        metrics.push(
          { label: 'Open tasks', value: String(tasks.data?.length ?? 0) },
          {
            label: 'Upcoming events',
            value: calendar.data?.connected ? String(calendar.data.events.length) : 'not connected',
          },
        );
      }
    }
    metrics.unshift({
      label: 'Workflows',
      value: `${String(owned.length)}${running ? ` · ${String(running)} running` : ''}`,
    });
    states.set(def.id, {
      def,
      status,
      statusLabel: STATUS_LABEL[status],
      automations: owned,
      running,
      failed,
      metrics,
    });
  }

  return {
    workspace,
    states,
    automations,
    executions,
    approvals,
    connections,
    invoices,
    expenses,
    tasks,
    calendar,
    loading: automations.isPending || executions.isPending,
  };
}
