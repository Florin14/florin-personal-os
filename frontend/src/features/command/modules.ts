import {
  BrainCircuit,
  Briefcase,
  CalendarClock,
  Cpu,
  GitBranch,
  HeartPulse,
  Home,
  type LucideIcon,
  ShoppingBag,
  Wallet,
} from 'lucide-react';

export type ModuleId =
  'engine' | 'business' | 'finance' | 'calendar' | 'shopping' | 'career' | 'home' | 'health' | 'ai';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  short: string;
  path: string;
  icon: LucideIcon;
  description: string;
  /** Workflow action namespaces that belong to this module (real backend actions). */
  actionPrefixes: string[];
  /** Integration providers this module depends on. */
  providers: string[];
  /** false = not built yet: rendered honestly as "planned". */
  available: boolean;
  phase: number;
  accent: 'electric' | 'cyan' | 'violet';
  position: { x: number; y: number };
}

/** The modules shown on the neural canvas. Positions form a hub-and-spoke layout. */
export const MODULES: ModuleDef[] = [
  {
    id: 'engine',
    label: 'Automation Engine',
    short: 'Engine',
    path: '/workflows',
    icon: Cpu,
    description: 'Durable workflows, schedules, approvals and the job worker.',
    actionPrefixes: ['core.'],
    providers: [],
    available: true,
    phase: 2,
    accent: 'cyan',
    position: { x: 0, y: 0 },
  },
  {
    id: 'business',
    label: 'Business & Accounting',
    short: 'Business',
    path: '/business',
    icon: Briefcase,
    description: 'Oblio invoicing, SPV submission and recurring invoices for FLOZITECH SRL.',
    actionPrefixes: ['invoicing.'],
    providers: ['oblio'],
    available: true,
    phase: 3,
    accent: 'electric',
    position: { x: -330, y: -190 },
  },
  {
    id: 'finance',
    label: 'Finance',
    short: 'Finance',
    path: '/finance',
    icon: Wallet,
    description: 'Documents, receipts, expenses and (soon) bank reconciliation.',
    actionPrefixes: ['documents.'],
    providers: ['google'],
    available: true,
    phase: 4,
    accent: 'electric',
    position: { x: -330, y: 190 },
  },
  {
    id: 'calendar',
    label: 'Calendar & Tasks',
    short: 'Calendar',
    path: '/calendar',
    icon: CalendarClock,
    description: 'Google Calendar events, reminders and automatic task scheduling.',
    actionPrefixes: ['calendar.'],
    providers: ['google'],
    available: true,
    phase: 4,
    accent: 'cyan',
    position: { x: 330, y: -190 },
  },
  {
    id: 'ai',
    label: 'AI Intelligence',
    short: 'AI',
    path: '/ai',
    icon: BrainCircuit,
    description: 'Optional, budgeted AI assistance — local or cloud, never mandatory.',
    actionPrefixes: ['ai.'],
    providers: [],
    available: false,
    phase: 6,
    accent: 'violet',
    position: { x: -500, y: 0 },
  },
  {
    id: 'shopping',
    label: 'Shopping Intelligence',
    short: 'Shopping',
    path: '/shopping',
    icon: ShoppingBag,
    description: 'Price history, alerts and merchant comparison.',
    actionPrefixes: ['shopping.'],
    providers: [],
    available: false,
    phase: 5,
    accent: 'violet',
    position: { x: 0, y: 270 },
  },
  {
    id: 'career',
    label: 'Freelance & Career',
    short: 'Career',
    path: '/opportunities',
    icon: GitBranch,
    description: 'Freelance opportunities matched to your skills.',
    actionPrefixes: ['opportunities.'],
    providers: [],
    available: false,
    phase: 6,
    accent: 'violet',
    position: { x: 0, y: -270 },
  },
  {
    id: 'home',
    label: 'Smart Home',
    short: 'Home',
    path: '/home',
    icon: Home,
    description: 'Home Assistant devices with safe, approved commands.',
    actionPrefixes: ['smarthome.'],
    providers: ['home_assistant'],
    available: true,
    phase: 7,
    accent: 'violet',
    position: { x: 330, y: 190 },
  },
  {
    id: 'health',
    label: 'Health & Lifestyle',
    short: 'Health',
    path: '/health',
    icon: HeartPulse,
    description: 'Routines, habits and shared planning.',
    actionPrefixes: ['health.'],
    providers: [],
    available: false,
    phase: 7,
    accent: 'violet',
    position: { x: 500, y: 0 },
  },
];

export interface Relationship {
  source: ModuleId;
  target: ModuleId;
  label: string;
}

/**
 * Architectural/automation relationships. Edges between two available modules are real
 * today (e.g. the engine orchestrates invoicing actions); others describe the roadmap.
 */
export const RELATIONSHIPS: Relationship[] = [
  { source: 'engine', target: 'business', label: 'orchestrates' },
  { source: 'engine', target: 'calendar', label: 'schedules' },
  { source: 'engine', target: 'finance', label: 'archives' },
  { source: 'business', target: 'finance', label: 'feeds' },
  { source: 'ai', target: 'engine', label: 'assists' },
  { source: 'ai', target: 'finance', label: 'classifies' },
  { source: 'shopping', target: 'finance', label: 'expenses' },
  { source: 'career', target: 'business', label: 'contracts' },
  { source: 'career', target: 'calendar', label: 'books' },
  { source: 'engine', target: 'home', label: 'controls' },
  { source: 'health', target: 'calendar', label: 'routines' },
];

export function moduleById(id: ModuleId): ModuleDef {
  const found = MODULES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown module ${id}`);
  return found;
}
