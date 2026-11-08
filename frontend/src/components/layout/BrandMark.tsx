/** "Connected nodes" logo mark (decorative). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="pos-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fa2ff" />
          <stop offset="1" stopColor="#2fd6f0" />
        </linearGradient>
      </defs>
      <g stroke="url(#pos-mark)" strokeWidth="1.5" strokeLinecap="round" opacity="0.75">
        <line x1="8" y1="9" x2="22" y2="7" />
        <line x1="8" y1="9" x2="16" y2="23" />
        <line x1="22" y1="7" x2="16" y2="23" />
        <line x1="22" y1="7" x2="26" y2="18" />
        <line x1="16" y1="23" x2="26" y2="18" />
      </g>
      <circle cx="8" cy="9" r="3" fill="#7fa2ff" />
      <circle cx="22" cy="7" r="2.4" fill="#2fd6f0" />
      <circle cx="16" cy="23" r="3.4" fill="#4f7dff" />
      <circle cx="26" cy="18" r="2.1" fill="#9b7bff" />
    </svg>
  );
}
