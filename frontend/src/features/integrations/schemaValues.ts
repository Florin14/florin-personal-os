export interface PropSchema {
  type?: string;
  title?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  anyOf?: PropSchema[];
}

export interface ObjectSchema {
  properties?: Record<string, PropSchema>;
  required?: string[];
}

export type FieldValues = Record<string, string | boolean>;

export function kindOf(prop: PropSchema): 'enum' | 'boolean' | 'json' | 'text' {
  if (prop.enum) return 'enum';
  if (prop.type === 'boolean') return 'boolean';
  if (prop.type === 'array' || prop.type === 'object') return 'json';
  return 'text';
}

export function humanize(key: string): string {
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Initial form state from a schema and optional current values. */
export function initialValues(
  schema: ObjectSchema,
  current?: Record<string, unknown>,
): FieldValues {
  const values: FieldValues = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const value = current?.[key] ?? prop.default;
    const kind = kindOf(prop);
    if (kind === 'boolean') values[key] = Boolean(value);
    else if (kind === 'json')
      values[key] = JSON.stringify(value ?? (prop.type === 'array' ? [] : {}), null, 2);
    else
      values[key] =
        typeof value === 'string'
          ? value
          : value === undefined || value === null
            ? ''
            : JSON.stringify(value);
  }
  return values;
}

/** Converts form state to the JSON payload; throws on invalid JSON fields. */
export function toPayload(schema: ObjectSchema, values: FieldValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const value = values[key];
    const kind = kindOf(prop);
    if (kind === 'boolean') payload[key] = Boolean(value);
    else if (kind === 'json') payload[key] = JSON.parse(String(value || 'null')) as unknown;
    else if (value !== '' && value !== undefined) payload[key] = value;
  }
  return payload;
}
