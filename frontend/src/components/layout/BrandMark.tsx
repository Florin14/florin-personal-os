import { useTheme } from '@mui/material';

/** Small "connected nodes" logo mark. Decorative. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const { palette } = useTheme();
  const a = palette.primary.main;
  const b = palette.secondary.main;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g stroke={a} strokeWidth="1.6" strokeLinecap="round" opacity="0.8">
        <line x1="8" y1="9" x2="22" y2="7" />
        <line x1="8" y1="9" x2="16" y2="23" />
        <line x1="22" y1="7" x2="16" y2="23" />
        <line x1="22" y1="7" x2="26" y2="18" />
        <line x1="16" y1="23" x2="26" y2="18" />
      </g>
      <circle cx="8" cy="9" r="3.2" fill={a} />
      <circle cx="22" cy="7" r="2.6" fill={b} />
      <circle cx="16" cy="23" r="3.6" fill={a} />
      <circle cx="26" cy="18" r="2.2" fill={b} />
    </svg>
  );
}
