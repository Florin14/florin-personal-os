import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/layout/BrandMark';

/** Decorative constellation behind the sign-in card (pure SVG, no runtime cost). */
function Constellation() {
  const nodes: [number, number][] = [
    [80, 120],
    [260, 60],
    [420, 180],
    [180, 300],
    [360, 360],
    [560, 90],
    [620, 300],
    [480, 470],
    [140, 470],
  ];
  const links: [number, number][] = [
    [0, 1],
    [1, 2],
    [0, 3],
    [3, 4],
    [2, 4],
    [1, 5],
    [5, 6],
    [4, 7],
    [3, 8],
    [6, 7],
    [2, 6],
  ];
  return (
    <svg viewBox="0 0 700 540" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="auth-link" x1="0" x2="1">
          <stop offset="0" stopColor="#4f7dff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#2fd6f0" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {links.map(([a, b]) => (
        <line
          key={`${String(a)}-${String(b)}`}
          x1={nodes[a]?.[0]}
          y1={nodes[a]?.[1]}
          x2={nodes[b]?.[0]}
          y2={nodes[b]?.[1]}
          stroke="url(#auth-link)"
          strokeWidth="1"
          strokeDasharray="4 6"
          className="animate-flow"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <g key={`${String(x)}-${String(y)}`}>
          <circle
            cx={x}
            cy={y}
            r={i % 3 === 0 ? 7 : 4.5}
            fill={i % 2 ? '#2fd6f0' : '#4f7dff'}
            opacity="0.9"
          />
          <circle
            cx={x}
            cy={y}
            r={i % 3 === 0 ? 18 : 12}
            fill={i % 2 ? '#2fd6f0' : '#4f7dff'}
            opacity="0.08"
          />
        </g>
      ))}
    </svg>
  );
}

/** Split layout for sign-in and MFA screens. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section
        className="relative hidden overflow-hidden border-r border-line lg:block"
        aria-hidden
      >
        <div className="neural-grid absolute inset-0 opacity-60" />
        <div className="absolute inset-0 flex items-center justify-center p-12">
          <Constellation />
        </div>
        <div className="absolute bottom-10 left-10 max-w-sm">
          <p className="label-caps mb-2">Personal OS</p>
          <p className="font-display text-3xl leading-tight font-semibold">
            Your life and business,{' '}
            <span className="text-gradient">wired into one intelligent system.</span>
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center p-5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="glass w-full max-w-sm rounded-lg p-7"
        >
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <BrandMark size={44} />
            <div>
              <h1 className="font-display text-xl font-semibold">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
            </div>
          </div>
          {children}
        </motion.div>
      </section>
    </main>
  );
}
