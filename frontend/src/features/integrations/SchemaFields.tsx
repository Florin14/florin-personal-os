import { FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';

import { humanize, kindOf, type FieldValues, type ObjectSchema } from './schemaValues';

export function SchemaFields({
  schema,
  values,
  onChange,
}: {
  schema: ObjectSchema;
  values: FieldValues;
  onChange: (key: string, value: string | boolean) => void;
}) {
  const required = new Set(schema.required ?? []);
  return (
    <Stack spacing={2}>
      {Object.entries(schema.properties ?? {}).map(([key, prop]) => {
        const label = prop.title ?? humanize(key);
        const kind = kindOf(prop);
        if (kind === 'boolean') {
          return (
            <FormControlLabel
              key={key}
              control={
                <Switch checked={Boolean(values[key])} onChange={(_, v) => onChange(key, v)} />
              }
              label={label}
            />
          );
        }
        if (kind === 'enum') {
          return (
            <TextField
              key={key}
              select
              label={label}
              value={values[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
              required={required.has(key)}
            >
              {(prop.enum ?? []).map((option) => (
                <MenuItem key={String(option)} value={String(option)}>
                  {String(option)}
                </MenuItem>
              ))}
            </TextField>
          );
        }
        return (
          <TextField
            key={key}
            label={kind === 'json' ? `${label} (JSON)` : label}
            value={values[key] ?? ''}
            onChange={(e) => onChange(key, e.target.value)}
            required={required.has(key)}
            multiline={kind === 'json'}
            minRows={kind === 'json' ? 3 : undefined}
            slotProps={
              kind === 'json' ? { input: { sx: { fontFamily: 'monospace', fontSize: 13 } } } : {}
            }
          />
        );
      })}
    </Stack>
  );
}
