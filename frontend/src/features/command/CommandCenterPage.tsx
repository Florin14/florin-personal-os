import { motion } from 'motion/react';
import { useState } from 'react';

import { useAuthState } from '@/api/auth';

import { ContextPanel } from './ContextPanel';
import { DashboardSections } from './DashboardSections';
import type { ModuleId } from './modules';
import { NeuralCanvas } from './NeuralCanvas';
import { useCommandData } from './useCommandData';

function greeting(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The main dashboard: neural module map, context panel and operational sections. */
export default function CommandCenterPage() {
  const { data: auth } = useAuthState();
  const data = useCommandData();
  const [selected, setSelected] = useState<ModuleId | null>(null);
  const timeZone = auth?.user.timezone ?? 'UTC';
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(
      new Date(),
    ),
  );
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date());

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <p className="label-caps">
          {date} · {data.workspace?.name ?? ''}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting(hour)}, <span className="text-gradient">{auth?.user.display_name}</span>
        </h1>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[56vh] min-h-[460px] lg:h-[calc(100vh-210px)] lg:max-h-[760px]">
          <NeuralCanvas states={data.states} selected={selected} onSelect={setSelected} />
        </div>
        <div className="lg:h-[calc(100vh-210px)] lg:max-h-[760px]">
          <ContextPanel
            states={data.states}
            selected={selected}
            executions={data.executions.data ?? []}
          />
        </div>
      </div>

      <DashboardSections data={data} />
    </div>
  );
}
