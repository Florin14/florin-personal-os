import {
  BrainCircuit,
  Briefcase,
  CalendarClock,
  CheckCheck,
  GitBranch,
  HeartPulse,
  History,
  Home,
  LayoutDashboard,
  type LucideIcon,
  Network,
  Plug,
  ShieldCheck,
  ShoppingBag,
  Wallet,
  Workflow,
} from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Implementation phase in which the area becomes functional. */
  phase: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Areas with a working implementation; all others show an honest "planned" page. */
export const IMPLEMENTED_PATHS = new Set([
  '/',
  '/network',
  '/workflows',
  '/approvals',
  '/executions',
  '/business',
  '/finance',
  '/calendar',
  '/integrations',
  '/settings',
]);

const item = (
  path: string,
  label: string,
  description: string,
  icon: LucideIcon,
  phase: number,
): NavItem => ({ path, label, description, icon, phase });

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Command',
    items: [
      item(
        '/',
        'Command Center',
        'Neural overview of every module and workflow.',
        LayoutDashboard,
        1,
      ),
      item(
        '/network',
        'Automation Network',
        'Triggers, automations and the systems they act on.',
        Network,
        2,
      ),
      item(
        '/workflows',
        'Workflow Builder',
        'Typed, versioned workflows with approval gates.',
        Workflow,
        2,
      ),
      item(
        '/executions',
        'Executions & Logs',
        'Execution history, retries and failures.',
        History,
        2,
      ),
      item(
        '/approvals',
        'Approval Inbox',
        'Review sensitive actions before they run.',
        CheckCheck,
        2,
      ),
    ],
  },
  {
    title: 'Domains',
    items: [
      item(
        '/business',
        'Business & Accounting',
        'Oblio invoices, SPV and recurring invoicing.',
        Briefcase,
        3,
      ),
      item('/finance', 'Finance', 'Documents, expenses and (soon) bank reconciliation.', Wallet, 4),
      item(
        '/calendar',
        'Calendar & Tasks',
        'Google Calendar, reminders and task scheduling.',
        CalendarClock,
        4,
      ),
      item(
        '/shopping',
        'Shopping Intelligence',
        'Price history, alerts and merchant comparison.',
        ShoppingBag,
        5,
      ),
      item(
        '/opportunities',
        'Freelance & Career',
        'Freelance listings matched to your profile.',
        GitBranch,
        6,
      ),
      item(
        '/ai',
        'AI Intelligence',
        'Optional, budgeted AI assistance (local or cloud).',
        BrainCircuit,
        6,
      ),
      item('/home', 'Smart Home', 'Home Assistant devices, states and safe commands.', Home, 7),
      item('/health', 'Health & Lifestyle', 'Habits, routines and shared planning.', HeartPulse, 7),
    ],
  },
  {
    title: 'System',
    items: [
      item(
        '/integrations',
        'Integrations',
        'Provider connections, credentials and health.',
        Plug,
        3,
      ),
      item(
        '/settings',
        'Settings & Security',
        'MFA, sessions, activity and preferences.',
        ShieldCheck,
        1,
      ),
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function isAvailable(navItem: NavItem): boolean {
  return IMPLEMENTED_PATHS.has(navItem.path);
}
