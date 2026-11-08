import { Box, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderValue(value: unknown) {
  if (isPlainObject(value) || Array.isArray(value)) {
    return (
      <Box
        component="pre"
        sx={{
          m: 0,
          fontSize: 12,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {JSON.stringify(value, null, 2)}
      </Box>
    );
  }
  if (value === null || value === undefined || value === '') return <em>—</em>;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Readable table for structured data (approval payloads, step inputs/outputs). */
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
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyLabel}
      </Typography>
    );
  }
  return (
    <Table size="small" aria-label={label}>
      <TableBody>
        {entries.map(([key, value]) => (
          <TableRow key={key}>
            <TableCell
              component="th"
              scope="row"
              sx={{ width: '35%', color: 'text.secondary', verticalAlign: 'top', fontWeight: 500 }}
            >
              {key}
            </TableCell>
            <TableCell sx={{ verticalAlign: 'top', wordBreak: 'break-word' }}>
              {renderValue(value)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
