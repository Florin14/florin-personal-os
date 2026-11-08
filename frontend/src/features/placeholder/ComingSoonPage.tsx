import { Construction } from 'lucide-react';

import type { NavItem } from '@/components/layout/navigation';
import { Badge } from '@/components/ui/surface';

/** Honest placeholder for areas planned for a later phase (nothing is simulated). */
export function ComingSoonPage({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-md border border-violet/40 bg-violet/10 text-violet">
          <Icon className="size-5" aria-hidden />
        </span>
        <h1 className="font-display text-2xl font-semibold">{item.label}</h1>
        <Badge tone="violet">Planned · phase {item.phase}</Badge>
      </div>
      <div className="glass neural-grid flex flex-col items-center gap-3 rounded-lg px-6 py-20 text-center">
        <Construction className="size-8 text-ink-dim" aria-hidden />
        <h2 className="font-display text-lg font-semibold">Not available yet</h2>
        <p className="max-w-lg text-sm text-ink-muted">
          {item.description} This area is scheduled for phase {item.phase} of the implementation
          plan. It is shown on the neural map so you can see where it will connect.
        </p>
      </div>
    </div>
  );
}
