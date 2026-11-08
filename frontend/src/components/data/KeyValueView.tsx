function isStructured(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

function renderValue(value: unknown) {
  if (isStructured(value)) {
    return (
      <pre className="m-0 font-mono text-xs break-words whitespace-pre-wrap text-ink-muted">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  if (value === null || value === undefined || value === '')
    return <span className="text-ink-dim">—</span>;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Readable definition list for structured data (approval payloads, step input/output). */
export function KeyValueView({
  data,
  emptyLabel = 'No data',
  label,
}: {
  data: Record<string, unknown>;
  emptyLabel?: string;
  label?: string;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="text-sm text-ink-dim">{emptyLabel}</p>;
  return (
    <table className="w-full text-sm" aria-label={label}>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-line/60 last:border-0">
            <th
              scope="row"
              className="w-[38%] py-2 pr-3 text-left align-top font-mono text-xs font-normal text-ink-dim"
            >
              {key}
            </th>
            <td className="py-2 align-top break-words text-ink">{renderValue(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
