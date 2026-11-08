import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';

import { humanize, kindOf, type FieldValues, type ObjectSchema } from './schemaValues';

/** Form fields generated from a provider's JSON schema (non-secret settings). */
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
    <div className="space-y-3">
      {Object.entries(schema.properties ?? {}).map(([key, prop]) => {
        const label = prop.title ?? humanize(key);
        const kind = kindOf(prop);
        if (kind === 'boolean') {
          return <SwitchField key={key} label={label} checked={Boolean(values[key])} onCheckedChange={(v) => onChange(key, v)} />;
        }
        if (kind === 'enum') {
          return (
            <Field key={key} label={label} required={required.has(key)}>
              {(p) => (
                <Select {...p} value={String(values[key] ?? '')} onChange={(e) => onChange(key, e.target.value)}>
                  {(prop.enum ?? []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                </Select>
              )}
            </Field>
          );
        }
        if (kind === 'json') {
          return (
            <Field key={key} label={`${label} (JSON)`} required={required.has(key)}>
              {(p) => <Textarea {...p} value={String(values[key] ?? '')} onChange={(e) => onChange(key, e.target.value)} className="font-mono text-xs" />}
            </Field>
          );
        }
        return (
          <Field key={key} label={label} required={required.has(key)}>
            {(p) => <Input {...p} value={String(values[key] ?? '')} onChange={(e) => onChange(key, e.target.value)} required={required.has(key)} />}
          </Field>
        );
      })}
    </div>
  );
}
