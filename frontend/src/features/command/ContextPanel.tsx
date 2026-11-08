import { ArrowUpRight, Play, Plus, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router';

import type { Execution } from '@/api/types';
import { relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/surface';

import type { ModuleId } from './modules';
import type { ModuleState } from './useCommandData';

function Overview({ states }: { states: Map<ModuleId, ModuleState> }) {
  const all = [...states.values()];
  const live = all.filter((s) => s.status !== 'planned');
  return (
    <div className="space-y-5">
      <div>
        <p className="label-caps">System overview</p>
        <h2 className="mt-1 font-display text-lg font-semibold">Neural map</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Select a module to inspect its workflows, recent events and quick actions. Lines show how
          modules feed each other; dashed lines are on the roadmap.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ['Live modules', live.length],
          ['Running', all.reduce((n, s) => n + s.running, 0)],
          ['Need attention', all.filter((s) => s.status === 'attention').length],
          ['Planned', all.length - live.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-md border border-line bg-base/50 px-3 py-2">
            <p className="label-caps">{label}</p>
            <p className="mt-0.5 font-display text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <ul className="space-y-1.5">
        {all.map((s) => (
          <li key={s.def.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-ink-muted">
              <s.def.icon className="size-3.5 text-electric-soft" aria-hidden />
              {s.def.label}
            </span>
            <span className="font-mono text-[11px] text-ink-dim">{s.statusLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModuleDetail({ state, executions }: { state: ModuleState; executions: Execution[] }) {
  const { def } = state;
  const Icon = def.icon;
  const ids = new Set(state.automations.map((a) => a.id));
  const names = new Map(state.automations.map((a) => [a.id, a.name]));
  const recent = executions.filter((e) => ids.has(e.automation_id)).slice(0, 5);
  const planned = state.status === 'planned';
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-md border border-cyan/40 bg-cyan/10 text-cyan shadow-glow-cyan">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="label-caps">Module</p>
          <h2 className="font-display text-lg leading-tight font-semibold">{def.label}</h2>
          <p className="mt-1 text-sm text-ink-muted">{def.description}</p>
        </div>
      </div>

      <dl className="divide-y divide-line/70 rounded-md border border-line bg-base/50 px-3">
        <div className="flex justify-between py-2 text-sm">
          <dt className="text-ink-dim">Status</dt>
          <dd className="font-medium">{state.statusLabel}</dd>
        </div>
        {state.metrics.map((m) => (
          <div key={m.label} className="flex justify-between gap-3 py-2 text-sm">
            <dt className="text-ink-dim">{m.label}</dt>
            <dd className="text-right font-mono text-ink-muted tabular-nums">{m.value}</dd>
          </div>
        ))}
      </dl>

      {planned ? (
        <div className="rounded-md border border-dashed border-violet/40 bg-violet/[0.05] p-3 text-sm text-ink-muted">
          <Sparkles className="mb-1 size-4 text-violet" aria-hidden />
          Not built yet — scheduled for phase {def.phase}. Nothing here is simulated.
        </div>
      ) : (
        <>
          <section aria-labelledby="ctx-workflows">
            <h3 id="ctx-workflows" className="label-caps mb-2">
              Active workflows
            </h3>
            {state.automations.length === 0 ? (
              <p className="text-sm text-ink-dim">No automations use this module yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {state.automations.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/workflows/${a.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-line bg-base/40 px-3 py-2 text-sm hover:border-electric/50"
                    >
                      <span className="truncate">{a.name}</span>
                      <Badge tone={a.enabled ? 'success' : 'neutral'}>
                        {a.enabled ? 'on' : 'off'}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="ctx-events">
            <h3 id="ctx-events" className="label-caps mb-2">
              Recent events
            </h3>
            {recent.length === 0 ? (
              <p className="text-sm text-ink-dim">No executions yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {recent.map((e) => (
                  <li key={e.id}>
                    <Link
                      to={`/executions/${e.id}`}
                      className="flex items-center justify-between gap-2 text-sm hover:text-ink"
                    >
                      <span className="truncate text-ink-muted">
                        {names.get(e.automation_id)} · {relativeTime(e.created_at)}
                      </span>
                      <StatusChip status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary" size="sm">
          <Link to={def.path}>
            Open {def.short} <ArrowUpRight />
          </Link>
        </Button>
        {!planned && (
          <>
            <Button asChild size="sm">
              <Link to="/workflows/new">
                <Plus /> New automation
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/executions">
                <Play /> Executions
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function ContextPanel({
  states,
  selected,
  executions,
}: {
  states: Map<ModuleId, ModuleState>;
  selected: ModuleId | null;
  executions: Execution[];
}) {
  const state = selected ? states.get(selected) : undefined;
  return (
    <aside
      aria-label="Module details"
      aria-live="polite"
      className="glass h-full overflow-y-auto rounded-lg p-4"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={selected ?? 'overview'}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18 }}
        >
          {state ? (
            <ModuleDetail state={state} executions={executions} />
          ) : (
            <Overview states={states} />
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
