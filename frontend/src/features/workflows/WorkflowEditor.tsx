import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  useActionCatalog,
  useAutomationVersions,
  useRunAutomation,
  useSaveAutomation,
  useSetAutomationEnabled,
} from '@/api/automation';
import { errorMessage } from '@/api/client';
import type { Automation } from '@/api/types';
import { dateTime } from '@/components/data/format';

import { FlowCanvas } from './FlowCanvas';
import { toDefinitionView, workflowGraph } from './graph';
import { TEMPLATES } from './templates';

type Parsed = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

function parseJson(text: string): Parsed {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, error: 'The definition must be a JSON object.' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function ActionCatalog() {
  const catalog = useActionCatalog();
  if (!catalog.data) return null;
  return (
    <Accordion disableGutters>
      <AccordionSummary>
        <Typography variant="subtitle2">
          Available actions ({String(catalog.data.length)})
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          {catalog.data.map((a) => {
            const props = Object.keys(
              (a.params_schema.properties as Record<string, unknown> | undefined) ?? {},
            );
            return (
              <Box key={a.name}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {a.name}
                  </Typography>
                  <Chip size="small" label={`risk ${a.risk}`} variant="outlined" />
                  {a.side_effecting && (
                    <Chip size="small" label="side effects" variant="outlined" />
                  )}
                  {a.requires_approval && (
                    <Chip size="small" label="approval required" color="warning" />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {a.description} Params: {props.length ? props.join(', ') : 'none'}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function Versions({ workspaceId, automationId }: { workspaceId: string; automationId: string }) {
  const versions = useAutomationVersions(workspaceId, automationId);
  if (!versions.data) return null;
  return (
    <Accordion disableGutters>
      <AccordionSummary>
        <Typography variant="subtitle2">Versions ({String(versions.data.length)})</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={0.5}>
          {versions.data.map((v) => (
            <Typography key={v.version} variant="body2">
              v{String(v.version)} · {dateTime(v.created_at)} ·{' '}
              <Box component="span" sx={{ fontFamily: 'monospace' }}>
                {v.definition_hash.slice(0, 12)}
              </Box>
            </Typography>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function WorkflowEditor({
  workspaceId,
  automation,
  canEdit,
}: {
  workspaceId: string;
  automation?: Automation;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const save = useSaveAutomation(workspaceId);
  const run = useRunAutomation(workspaceId);
  const toggle = useSetAutomationEnabled(workspaceId);
  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const [text, setText] = useState(() =>
    pretty(automation?.definition ?? TEMPLATES[0]?.definition ?? { steps: [] }),
  );
  const [payloadText, setPayloadText] = useState('{}');

  const parsed = useMemo(() => parseJson(text), [text]);
  const payload = useMemo(() => parseJson(payloadText), [payloadText]);
  const graph = useMemo(() => {
    const view = parsed.ok ? toDefinitionView(parsed.value) : null;
    return view ? workflowGraph(view) : null;
  }, [parsed]);
  const dirty =
    !automation ||
    name !== automation.name ||
    description !== automation.description ||
    (parsed.ok && pretty(parsed.value) !== pretty(automation.definition));

  const onSave = () => {
    if (!parsed.ok) return;
    save.mutate(
      {
        ...(automation ? { id: automation.id } : {}),
        input: { name: name.trim(), description, definition: parsed.value },
      },
      { onSuccess: (saved) => void navigate(`/workflows/${saved.id}`) },
    );
  };

  const onRun = (dryRun: boolean) => {
    if (!automation || !payload.ok) return;
    run.mutate(
      { id: automation.id, dryRun, payload: payload.value },
      { onSuccess: (execution) => void navigate(`/executions/${execution.id}`) },
    );
  };

  return (
    <Stack spacing={2.5}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={!canEdit}
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              {!automation && (
                <TextField
                  select
                  label="Start from template"
                  value=""
                  onChange={(e) => {
                    const template = TEMPLATES.find((t) => t.id === e.target.value);
                    if (template) {
                      setText(pretty(template.definition));
                      if (!name) setName(template.label);
                    }
                  }}
                  sx={{ minWidth: 220 }}
                >
                  {TEMPLATES.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit}
              multiline
              minRows={1}
            />
            <TextField
              label="Definition (JSON)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              multiline
              minRows={14}
              disabled={!canEdit}
              error={!parsed.ok}
              helperText={
                parsed.ok ? 'Validated on save against the action catalog.' : parsed.error
              }
              slotProps={{
                htmlInput: { spellCheck: false },
                input: { sx: { fontFamily: 'monospace', fontSize: 13 } },
              }}
            />
            {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
            {!canEdit && (
              <Alert severity="info">Only workspace owners and admins can edit automations.</Alert>
            )}
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                variant="contained"
                onClick={onSave}
                disabled={!canEdit || !parsed.ok || !name.trim() || !dirty}
                loading={save.isPending}
              >
                {automation ? 'Save new version' : 'Create automation'}
              </Button>
              {parsed.ok && (
                <Button variant="text" onClick={() => setText(pretty(parsed.value))}>
                  Format
                </Button>
              )}
              {automation && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={automation.enabled}
                      disabled={!canEdit || toggle.isPending}
                      onChange={(_, checked) =>
                        toggle.mutate({ id: automation.id, enabled: checked })
                      }
                    />
                  }
                  label={automation.enabled ? 'Enabled' : 'Disabled'}
                />
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {automation && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" component="h2">
                Run
              </Typography>
              <TextField
                label="Trigger payload (JSON)"
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                multiline
                minRows={2}
                error={!payload.ok}
                helperText={
                  payload.ok ? 'Available to steps as {{ trigger.<field> }}.' : payload.error
                }
                slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
              />
              {run.isError && <Alert severity="error">{errorMessage(run.error)}</Alert>}
              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={() => onRun(true)}
                  disabled={!payload.ok}
                  loading={run.isPending && run.variables.dryRun}
                >
                  Dry run
                </Button>
                <Button
                  variant="contained"
                  onClick={() => onRun(false)}
                  disabled={!payload.ok || !automation.enabled}
                  loading={run.isPending && !run.variables.dryRun}
                >
                  Run now
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Box>
        <Typography variant="h6" component="h2" gutterBottom>
          Preview
        </Typography>
        {graph ? (
          <FlowCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            height={380}
            label="Workflow preview"
          />
        ) : (
          <Alert severity="info">Fix the definition to see the workflow graph.</Alert>
        )}
      </Box>
      <Box>
        <ActionCatalog />
        {automation && <Versions workspaceId={workspaceId} automationId={automation.id} />}
      </Box>
    </Stack>
  );
}
