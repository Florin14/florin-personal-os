import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import BusinessCenterOutlined from '@mui/icons-material/BusinessCenterOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import RuleOutlined from '@mui/icons-material/RuleOutlined';
import SecurityOutlined from '@mui/icons-material/SecurityOutlined';
import ShoppingBagOutlined from '@mui/icons-material/ShoppingBagOutlined';
import WalletOutlined from '@mui/icons-material/WalletOutlined';
import WorkOutlineOutlined from '@mui/icons-material/WorkOutlineOutlined';
import type { SvgIconComponent } from '@mui/icons-material';

export interface NavItem {
  path: string;
  label: string;
  description: string;
  icon: SvgIconComponent;
  /** Implementation phase in which the area becomes functional. */
  phase: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Areas with a working implementation; all others show a "planned" page. */
export const IMPLEMENTED_PATHS = new Set(['/', '/approvals', '/executions', '/settings']);

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Command center',
    items: [
      {
        path: '/',
        label: 'Overview',
        description: 'System status, workspaces and what needs your attention.',
        icon: DashboardOutlined,
        phase: 1,
      },
      {
        path: '/network',
        label: 'Automation Network',
        description: 'Live map of automations, triggers and integrations.',
        icon: HubOutlined,
        phase: 2,
      },
      {
        path: '/workflows',
        label: 'Workflow Builder',
        description: 'Design typed, versioned workflows with approval gates.',
        icon: AccountTreeOutlined,
        phase: 2,
      },
      {
        path: '/executions',
        label: 'Executions & Logs',
        description: 'Execution history, retries, failures and audit trail.',
        icon: HistoryOutlined,
        phase: 2,
      },
      {
        path: '/approvals',
        label: 'Approval Inbox',
        description: 'Review and approve sensitive actions before they run.',
        icon: RuleOutlined,
        phase: 2,
      },
    ],
  },
  {
    title: 'Life & business',
    items: [
      {
        path: '/finance',
        label: 'Finance',
        description: 'Bank statement imports, reconciliation and savings insights.',
        icon: WalletOutlined,
        phase: 5,
      },
      {
        path: '/business',
        label: 'Business & Accounting',
        description: 'Invoices via Oblio, SPV status and accountant-ready documents.',
        icon: BusinessCenterOutlined,
        phase: 3,
      },
      {
        path: '/shopping',
        label: 'Shopping Tracker',
        description: 'Price history, alerts and merchant comparison.',
        icon: ShoppingBagOutlined,
        phase: 5,
      },
      {
        path: '/calendar',
        label: 'Calendar & Tasks',
        description: 'Google Calendar, reminders and task scheduling.',
        icon: CalendarMonthOutlined,
        phase: 4,
      },
      {
        path: '/opportunities',
        label: 'Freelance Opportunities',
        description: 'Relevant freelance listings matched to your profile.',
        icon: WorkOutlineOutlined,
        phase: 6,
      },
      {
        path: '/home',
        label: 'Smart Home',
        description: 'Home Assistant devices, states and safe commands.',
        icon: HomeOutlined,
        phase: 7,
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        path: '/integrations',
        label: 'Integrations',
        description: 'Provider connections, credentials and health.',
        icon: ExtensionOutlined,
        phase: 3,
      },
      {
        path: '/settings',
        label: 'Settings & Security',
        description: 'Multi-factor authentication, sessions and preferences.',
        icon: SecurityOutlined,
        phase: 1,
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function isAvailable(item: NavItem): boolean {
  return IMPLEMENTED_PATHS.has(item.path);
}
