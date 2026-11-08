import { CalendarClock, CalendarPlus, ListTodo, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/api/client';
import {
  useCalendar,
  useCreateEvent,
  useSaveTask,
  useScheduleTask,
  useTasks,
  type CalendarEventInfo,
  type Task,
} from '@/api/workspaceData';
import { dateTime } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Modal, Tooltip } from '@/components/ui/overlay';
import { Panel } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function groupByDay(events: CalendarEventInfo[]): [string, CalendarEventInfo[]][] {
  const groups = new Map<string, CalendarEventInfo[]>();
  for (const event of events) {
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(event.start));
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  return [...groups.entries()];
}

function NewEventDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const create = useCreateEvent(workspaceId);
  const [summary, setSummary] = useState('');
  const [start, setStart] = useState('');
  const [duration, setDuration] = useState(30);
  const [reminder, setReminder] = useState<number | ''>(10);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title="New event or reminder"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!summary || !start}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { summary, start: new Date(start).toISOString(), duration_minutes: duration, timezone: TZ, description: '', reminder_minutes: reminder === '' ? null : reminder },
                { onSuccess: onClose },
              )
            }
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" required>{(p) => <Input {...p} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
        <Field label="Start" required>{(p) => <Input {...p} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)">{(p) => <Input {...p} type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />}</Field>
          <Field label="Reminder (min before)">
            {(p) => <Input {...p} type="number" value={reminder} onChange={(e) => setReminder(e.target.value === '' ? '' : Number(e.target.value))} />}
          </Field>
        </div>
        {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
      </div>
    </Modal>
  );
}

function TasksPanel({ workspaceId }: { workspaceId: string }) {
  const tasks = useTasks(workspaceId, false);
  const save = useSaveTask(workspaceId);
  const schedule = useScheduleTask(workspaceId);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(60);
  const toggle = (task: Task) =>
    save.mutate({ id: task.id, body: { title: task.title, notes: task.notes, due_date: task.due_date, duration_minutes: task.duration_minutes, status: task.status === 'done' ? 'open' : 'done' } });
  return (
    <Panel title="Tasks" icon={<ListTodo />}>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ body: { title, notes: '', due_date: null, duration_minutes: duration, status: 'open' } }, { onSuccess: () => setTitle('') });
        }}
      >
        <Input aria-label="New task" placeholder="New task…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input aria-label="Duration in minutes" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-20" />
        <Button type="submit" disabled={!title.trim()}>Add</Button>
      </form>
      {(save.error ?? schedule.error) && <Alert tone="danger" className="mb-2">{errorMessage(save.error ?? schedule.error)}</Alert>}
      {tasks.isPending ? (
        <LoadingState compact />
      ) : tasks.isError ? (
        <ErrorState compact error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : tasks.data.length === 0 ? (
        <EmptyState compact title="No open tasks" />
      ) : (
        <ul aria-label="Tasks" className="space-y-1">
          {tasks.data.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/[0.03]">
              <Checkbox checked={t.status === 'done'} onCheckedChange={() => toggle(t)} aria-label={`Mark ${t.title} done`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{t.title}</p>
                <p className="text-xs text-ink-dim">
                  {t.scheduled_start ? `Scheduled ${dateTime(t.scheduled_start)}` : `${String(t.duration_minutes)} min · not scheduled`}
                </p>
              </div>
              {!t.calendar_event_id && (
                <Tooltip content="Book into the next free slot">
                  <Button variant="ghost" size="icon-sm" aria-label={`Schedule ${t.title}`} onClick={() => schedule.mutate(t.id)} disabled={schedule.isPending}>
                    <Wand2 />
                  </Button>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function CalendarPage() {
  const workspace = useCurrentWorkspace();
  const calendar = useCalendar(workspace?.id);
  const [creating, setCreating] = useState(false);
  if (!workspace) return <EmptyState title="No workspace selected" />;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Domains"
        title="Calendar & Tasks"
        subtitle="Upcoming Google Calendar events and tasks booked into your free time."
        actions={calendar.data?.connected && <Button variant="primary" onClick={() => setCreating(true)}><CalendarPlus /> New event</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="Next 14 days" icon={<CalendarClock />}>
          {calendar.isPending ? (
            <LoadingState />
          ) : calendar.isError ? (
            <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
          ) : !calendar.data.connected ? (
            <EmptyState
              title="Google Calendar is not connected"
              description="Connect a Google account for this workspace to see and create events."
              action={<Button asChild variant="outline"><Link to="/integrations">Open integrations</Link></Button>}
            />
          ) : calendar.data.error ? (
            <Alert tone="danger">{calendar.data.error}</Alert>
          ) : calendar.data.events.length === 0 ? (
            <EmptyState title="Nothing scheduled" />
          ) : (
            <div className="space-y-4">
              {groupByDay(calendar.data.events).map(([day, events]) => (
                <section key={day} aria-label={day}>
                  <p className="label-caps mb-1.5">{day}</p>
                  <ul className="space-y-1.5">
                    {events.map((e) => (
                      <li key={e.id} className="flex gap-3 rounded-md border border-line bg-base/40 px-3 py-2">
                        <span className="w-24 shrink-0 font-mono text-xs text-cyan">{e.all_day ? 'all day' : `${time(e.start)}–${time(e.end)}`}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{e.summary}</span>
                          {e.location && <span className="block truncate text-xs text-ink-dim">{e.location}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Panel>
        <TasksPanel workspaceId={workspace.id} />
      </div>
      {creating && <NewEventDialog workspaceId={workspace.id} onClose={() => setCreating(false)} />}
    </div>
  );
}
