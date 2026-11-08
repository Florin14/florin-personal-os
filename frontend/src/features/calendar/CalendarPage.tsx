import EventOutlined from '@mui/icons-material/EventOutlined';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ScheduleSendOutlined from '@mui/icons-material/ScheduleSendOutlined';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';

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
import { DashboardCard } from '@/features/dashboard/DashboardCard';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function groupByDay(events: CalendarEventInfo[]): [string, CalendarEventInfo[]][] {
  const groups = new Map<string, CalendarEventInfo[]>();
  for (const event of events) {
    const day = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(event.start));
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
  const submit = () => {
    create.mutate(
      {
        summary,
        start: new Date(start).toISOString(),
        duration_minutes: duration,
        timezone: TZ,
        description: '',
        reminder_minutes: reminder === '' ? null : reminder,
      },
      { onSuccess: onClose },
    );
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="new-event-title">
      <DialogTitle id="new-event-title">New event or reminder</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Title"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            required
          />
          <TextField
            label="Start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Duration (minutes)"
            type="number"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
          <TextField
            label="Reminder (minutes before)"
            type="number"
            value={reminder}
            onChange={(e) => setReminder(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {create.isError && <Alert severity="error">{errorMessage(create.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!summary || !start}
          loading={create.isPending}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TasksCard({ workspaceId }: { workspaceId: string }) {
  const tasks = useTasks(workspaceId, false);
  const save = useSaveTask(workspaceId);
  const schedule = useScheduleTask(workspaceId);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(60);

  const toggle = (task: Task) =>
    save.mutate({
      id: task.id,
      body: {
        title: task.title,
        notes: task.notes,
        due_date: task.due_date,
        duration_minutes: task.duration_minutes,
        status: task.status === 'done' ? 'open' : 'done',
      },
    });

  return (
    <DashboardCard title="Tasks" icon={<ScheduleSendOutlined color="primary" />}>
      <Stack
        component="form"
        direction="row"
        spacing={1}
        sx={{ mb: 2 }}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            {
              body: {
                title,
                notes: '',
                due_date: null,
                duration_minutes: duration,
                status: 'open',
              },
            },
            { onSuccess: () => setTitle('') },
          );
        }}
      >
        <TextField
          size="small"
          label="New task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          size="small"
          label="Min"
          type="number"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          sx={{ width: 90 }}
        />
        <Button type="submit" variant="outlined" disabled={!title.trim()}>
          Add
        </Button>
      </Stack>
      {(save.error ?? schedule.error) && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {errorMessage(save.error ?? schedule.error)}
        </Alert>
      )}
      {tasks.isPending ? (
        <LoadingState compact />
      ) : tasks.isError ? (
        <ErrorState compact error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : tasks.data.length === 0 ? (
        <EmptyState compact title="No open tasks" />
      ) : (
        <List dense aria-label="Tasks">
          {tasks.data.map((t) => (
            <ListItem
              key={t.id}
              secondaryAction={
                !t.calendar_event_id && (
                  <Tooltip title="Book into the next free slot">
                    <IconButton
                      aria-label={`Schedule ${t.title}`}
                      onClick={() => schedule.mutate(t.id)}
                      disabled={schedule.isPending}
                    >
                      <EventOutlined />
                    </IconButton>
                  </Tooltip>
                )
              }
            >
              <Checkbox
                edge="start"
                checked={t.status === 'done'}
                onChange={() => toggle(t)}
                slotProps={{ input: { 'aria-label': `Mark ${t.title} done` } }}
              />
              <ListItemText
                primary={t.title}
                secondary={
                  t.scheduled_start
                    ? `Scheduled ${dateTime(t.scheduled_start)}`
                    : `${String(t.duration_minutes)} min · not scheduled`
                }
              />
            </ListItem>
          ))}
        </List>
      )}
    </DashboardCard>
  );
}

export function CalendarPage() {
  const workspace = useCurrentWorkspace();
  const calendar = useCalendar(workspace?.id);
  const [creating, setCreating] = useState(false);

  if (!workspace) return <EmptyState title="No workspace selected" />;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Calendar & Tasks"
        subtitle="Upcoming events from Google Calendar and your tasks, scheduled into free time."
        actions={
          calendar.data?.connected && (
            <Button variant="contained" onClick={() => setCreating(true)}>
              New event
            </Button>
          )
        }
      />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" component="h2" gutterBottom>
                Next 14 days
              </Typography>
              {calendar.isPending ? (
                <LoadingState />
              ) : calendar.isError ? (
                <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
              ) : !calendar.data.connected ? (
                <EmptyState
                  title="Google Calendar is not connected"
                  description="Connect a Google account for this workspace to see and create events."
                  action={
                    <Button component={RouterLink} to="/integrations" variant="outlined">
                      Open integrations
                    </Button>
                  }
                />
              ) : calendar.data.error ? (
                <Alert severity="error">{calendar.data.error}</Alert>
              ) : calendar.data.events.length === 0 ? (
                <EmptyState title="Nothing scheduled" />
              ) : (
                <Stack spacing={2}>
                  {groupByDay(calendar.data.events).map(([day, events]) => (
                    <div key={day}>
                      <Typography variant="overline" color="text.secondary">
                        {day}
                      </Typography>
                      <List dense disablePadding>
                        {events.map((e) => (
                          <ListItem key={e.id} disableGutters>
                            <ListItemText
                              primary={e.summary}
                              secondary={
                                e.all_day
                                  ? 'All day'
                                  : `${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(e.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${e.location ? ` · ${e.location}` : ''}`
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    </div>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <TasksCard workspaceId={workspace.id} />
        </Grid>
      </Grid>
      {creating && <NewEventDialog workspaceId={workspace.id} onClose={() => setCreating(false)} />}
    </Stack>
  );
}
