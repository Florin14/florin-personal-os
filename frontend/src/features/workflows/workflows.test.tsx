import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Automation } from '@/api/types';
import { apiError, authenticatedApi, json, renderRoute } from '@/test/utils';

import { networkGraph, successors, toDefinitionView, workflowGraph } from './graph';
import { TEMPLATES } from './templates';

const automation: Automation = {
  id: 'au1',
  workspace_id: 'a1',
  name: 'Threshold alert',
  description: '',
  enabled: true,
  version: 1,
  definition: TEMPLATES[2]!.definition,
  triggers: [],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

describe('workflow graph', () => {
  it('mirrors the engine successor rules', () => {
    const view = toDefinitionView(TEMPLATES[2]!.definition)!;
    expect(successors(view, 0)).toEqual([
      { target: 'alert', label: 'true' },
      { target: 'log_small', label: 'false' },
    ]);
    expect(successors(view, 1)).toEqual([{ target: 'end' }]);
    expect(successors(view, 2)).toEqual([{ target: 'end' }]);
  });

  it('builds nodes for triggers, steps and end', () => {
    const view = toDefinitionView(TEMPLATES[0]!.definition)!;
    const { nodes, edges } = workflowGraph(view);
    expect(nodes.map((n) => n.id)).toEqual(['trigger:monthly', 'trigger:1', 'step:remind', 'end']);
    expect(edges.some((e) => e.source === 'step:remind' && e.target === 'end')).toBe(true);
  });

  it('rejects unusable definitions', () => {
    expect(toDefinitionView(null)).toBeNull();
    expect(toDefinitionView({ steps: 'nope' })).toBeNull();
  });

  it('links automations to the systems they act on', () => {
    const { nodes, edges } = networkGraph([automation]);
    expect(nodes.some((n) => n.id === 'ns:notifications')).toBe(true);
    expect(nodes.some((n) => n.id === 'ns:core')).toBe(true);
    expect(edges.filter((e) => e.source === 'automation:au1')).toHaveLength(2);
  });
});

describe('Workflow Builder', () => {
  it('creates an automation from a template', async () => {
    const { calls } = authenticatedApi({
      'GET /api/v1/workspaces/a1/automations': [],
      'GET /api/v1/automation/actions': [],
      'POST /api/v1/workspaces/a1/automations': json(automation, 201),
      'GET /api/v1/workspaces/a1/automations/au1': automation,
      'GET /api/v1/workspaces/a1/automations/au1/versions': [],
    });
    const { router } = renderRoute('/workflows/new');
    const u = userEvent.setup();
    const name = await screen.findByLabelText(/^Name/, {}, { timeout: 5000 });
    await u.type(name, 'Monthly reminder');
    await u.click(screen.getByRole('button', { name: 'Create automation' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows/au1'));
    const call = calls.find((c) => c.method === 'POST' && c.url.endsWith('/automations'));
    const body = (await call?.json()) as { name: string; definition: { steps: unknown[] } };
    expect(body.name).toBe('Monthly reminder');
    expect(body.definition.steps).toHaveLength(1);
  });

  it('flags invalid JSON and shows server validation errors', async () => {
    authenticatedApi({
      'GET /api/v1/workspaces/a1/automations': [],
      'GET /api/v1/automation/actions': [],
      'POST /api/v1/workspaces/a1/automations': apiError(
        422,
        'invalid_workflow',
        "Invalid workflow: Step 'x': unknown action 'os.exec'.",
      ),
    });
    renderRoute('/workflows/new');
    const u = userEvent.setup();
    const editor = await screen.findByLabelText(/Definition \(JSON\)/, {}, { timeout: 5000 });
    await u.clear(editor);
    await u.type(editor, '{{ not json');
    expect(screen.getByRole('button', { name: 'Create automation' })).toBeDisabled();
    expect(screen.getByText('Fix the definition to see the workflow graph.')).toBeInTheDocument();

    await u.clear(editor);
    await u.click(editor);
    await u.paste('{"steps": []}');
    await u.type(screen.getByLabelText(/^Name/), 'Bad');
    await u.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(await screen.findByText(/unknown action 'os.exec'/)).toBeInTheDocument();
  });

  it('starts a dry run and opens the execution', async () => {
    const { calls } = authenticatedApi({
      'GET /api/v1/workspaces/a1/automations': [automation],
      'GET /api/v1/workspaces/a1/automations/au1': automation,
      'GET /api/v1/workspaces/a1/automations/au1/versions': [],
      'GET /api/v1/automation/actions': [],
      'POST /api/v1/workspaces/a1/automations/au1/run': json({ id: 'ex9' }, 202),
      'GET /api/v1/workspaces/a1/executions/ex9': apiError(404, 'not_found', 'gone'),
    });
    const { router } = renderRoute('/workflows/au1');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Dry run' }, { timeout: 5000 }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/executions/ex9'));
    const call = calls.find((c) => c.url.endsWith('/run'));
    await expect(call?.json()).resolves.toEqual({ dry_run: true, payload: {} });
  });
});
