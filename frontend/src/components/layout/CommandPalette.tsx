import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, Search, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAutomations } from '@/api/automation';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/stores/uiStore';

import { isAvailable, NAV_ITEMS } from './navigation';

interface Entry {
  id: string;
  label: string;
  hint: string;
  path: string;
  icon: typeof Workflow;
}

/** Global search (Ctrl/⌘+K) over areas and the current workspace's automations. */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const navigate = useNavigate();
  const workspace = useCurrentWorkspace();
  const automations = useAutomations(open ? workspace?.id : undefined);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const entries = useMemo<Entry[]>(() => {
    const areas: Entry[] = NAV_ITEMS.map((n) => ({
      id: n.path,
      label: n.label,
      hint: isAvailable(n) ? n.description : `Planned · phase ${String(n.phase)}`,
      path: n.path,
      icon: n.icon,
    }));
    const flows: Entry[] = (automations.data ?? []).map((a) => ({
      id: a.id,
      label: a.name,
      hint: `Automation · v${String(a.version)}${a.enabled ? '' : ' · disabled'}`,
      path: `/workflows/${a.id}`,
      icon: Workflow,
    }));
    const q = query.trim().toLowerCase();
    const all = [...areas, ...flows];
    return q ? all.filter((e) => `${e.label} ${e.hint}`.toLowerCase().includes(q)) : all;
  }, [automations.data, query]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    setOpen(false);
    setQuery('');
    void navigate(entry.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, entries.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(entries[index]);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-void/70 backdrop-blur-sm" />
        <DialogPrimitive.Content className="glass-strong fixed top-[12vh] left-1/2 z-50 w-[min(640px,94vw)] -translate-x-1/2 overflow-hidden rounded-lg shadow-2xl focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Search Personal OS</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Type to find areas and automations. Use arrow keys and Enter.
          </DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 text-cyan" aria-hidden />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search areas, automations…"
              aria-label="Search"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-results"
              aria-activedescendant={entries[index] ? `cmd-${entries[index].id}` : undefined}
              className="h-12 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-dim focus:outline-none"
            />
            <kbd className="rounded-sm border border-line px-1.5 font-mono text-[10px] text-ink-dim">
              ESC
            </kbd>
          </div>
          <ul id="command-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
            {entries.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-dim">No results</li>
            )}
            {entries.map((entry, i) => {
              const Icon = entry.icon;
              return (
                // Keyboard selection is handled by the combobox input (aria-activedescendant).
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={entry.id}
                  id={`cmd-${entry.id}`}
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(entry)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2',
                    i === index && 'bg-electric/15 shadow-[inset_0_0_0_1px_rgb(79_125_255/0.35)]',
                  )}
                >
                  <Icon className="size-4 text-electric-soft" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{entry.label}</span>
                    <span className="block truncate text-xs text-ink-dim">{entry.hint}</span>
                  </span>
                  {i === index && <CornerDownLeft className="size-3.5 text-ink-dim" aria-hidden />}
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
