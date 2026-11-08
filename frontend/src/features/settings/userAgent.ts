// Order matters: Edge also contains "Chrome", Chrome also contains "Safari", Android contains "Linux".
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

function firstMatch(ua: string, table: [RegExp, string][]): string | undefined {
  return table.find(([pattern]) => pattern.test(ua))?.[1];
}

/** Short human description of a user agent without a parsing dependency. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const parts = [firstMatch(ua, BROWSERS), firstMatch(ua, SYSTEMS)].filter(Boolean);
  return parts.length ? parts.join(' on ') : 'Other client';
}
