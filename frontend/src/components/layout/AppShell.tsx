import { ChevronsLeft, ChevronsRight, LogOut, Menu, Search, Settings } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { useAuthState, useLogout } from '@/api/auth';
import { useHealth } from '@/api/system';
import { ConnectionBanner } from '@/components/feedback/ConnectionBanner';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipProvider,
} from '@/components/ui/overlay';
import { Badge, StatusDot } from '@/components/ui/surface';
import { cn } from '@/lib/cn';
import { useUiStore } from '@/stores/uiStore';

import { BrandMark } from './BrandMark';
import { CommandPalette } from './CommandPalette';
import { isAvailable, NAV_SECTIONS } from './navigation';
import { NotificationsBell } from './NotificationsBell';
import { WorkspaceSelector } from './WorkspaceSelector';

function Wordmark() {
  return (
    <span className="font-display text-[15px] font-semibold tracking-[0.08em]">
      PERSONAL<span className="text-gradient"> OS</span>
    </span>
  );
}

function NavigationList({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2.5 pb-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="mt-4 first:mt-2">
          {!collapsed && <p className="label-caps px-2.5 pb-1.5">{section.title}</p>}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const available = isAvailable(item);
              const link = (
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  {...(onNavigate ? { onClick: onNavigate } : {})}
                  aria-label={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-electric/12 text-ink shadow-[inset_0_0_0_1px_rgb(79_125_255/0.35)]'
                        : 'text-ink-muted hover:bg-white/[0.04] hover:text-ink',
                      !available && 'opacity-60',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-cyan shadow-[0_0_10px_var(--color-cyan)]"
                        />
                      )}
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-cyan' : 'group-hover:text-electric-soft',
                        )}
                      />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && !available && (
                        <span
                          className="font-mono text-[9.5px] text-ink-dim"
                          aria-label={`Planned for phase ${String(item.phase)}`}
                        >
                          P{item.phase}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
              return (
                <li key={item.path}>
                  {collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SystemHealth() {
  const health = useHealth();
  const ok = health.data?.status === 'ok';
  const tone = health.isError ? 'danger' : ok ? 'success' : 'warning';
  const label = health.isError ? 'Offline' : ok ? 'All systems nominal' : 'Checking';
  return (
    <div
      className="hidden items-center gap-2 rounded-md border border-line bg-base/60 px-2.5 py-1.5 lg:flex"
      role="status"
      aria-label={`System health: ${label}`}
    >
      <StatusDot tone={tone} pulse={ok} />
      <span className="font-mono text-[11px] text-ink-muted">{label}</span>
    </div>
  );
}

function ProfileMenu() {
  const { data } = useAuthState();
  const logout = useLogout();
  const navigate = useNavigate();
  const name = data?.user.display_name ?? '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-electric to-violet font-display text-sm font-semibold text-white shadow-glow"
        >
          {name.slice(0, 1).toUpperCase() || '?'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium text-ink">{name}</p>
          <p className="text-xs text-ink-dim">{data?.user.email}</p>
          {data?.user.is_admin && (
            <Badge tone="violet" className="mt-1.5">
              Administrator
            </Badge>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate('/settings')}>
          <Settings /> Settings & security
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            logout.mutate(undefined, {
              onSettled: () => void navigate('/login', { replace: true }),
            })
          }
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Command-center frame: collapsible sidebar, top bar, contextual content. */
export function AppShell() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const mobileOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileOpen = useUiStore((s) => s.setMobileNavOpen);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);

  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <a
          href="#main-content"
          className="sr-only z-[100] rounded-md bg-surface-3 px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>

        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-base/70 backdrop-blur-xl transition-[width] duration-200 md:flex',
            collapsed ? 'w-[68px]' : 'w-64',
          )}
        >
          <div
            className={cn(
              'flex h-14 items-center gap-2.5 px-4',
              collapsed && 'justify-center px-0',
            )}
          >
            <BrandMark size={26} />
            {!collapsed && <Wordmark />}
          </div>
          {!collapsed && (
            <div className="px-3">
              <WorkspaceSelector compact />
            </div>
          )}
          <NavigationList collapsed={collapsed} />
          <div className="border-t border-line p-2.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn('w-full', collapsed ? 'justify-center' : 'justify-start')}
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
              {!collapsed && 'Collapse'}
            </Button>
          </div>
        </aside>

        <Drawer open={mobileOpen} onOpenChange={setMobileOpen} title="Navigation">
          <div className="flex h-14 items-center gap-2.5 px-4">
            <BrandMark size={26} />
            <Wordmark />
          </div>
          <div className="px-3">
            <WorkspaceSelector compact />
          </div>
          <NavigationList collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </Drawer>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-line bg-void/70 backdrop-blur-xl">
            <ConnectionBanner />
            <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
              >
                <Menu />
              </Button>
              <span className="md:hidden">
                <Wordmark />
              </span>
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="ml-auto flex h-9 items-center gap-2.5 rounded-md border border-line bg-base/60 px-3 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink-muted sm:w-full sm:max-w-sm md:ml-0"
                aria-label="Search (Control K)"
              >
                <Search className="size-4" aria-hidden />
                <span className="hidden flex-1 text-left sm:block">Search Personal OS…</span>
                <kbd className="hidden rounded-sm border border-line px-1.5 font-mono text-[10px] sm:block">
                  Ctrl K
                </kbd>
              </button>
              <div className="ml-auto flex items-center gap-2">
                <SystemHealth />
                <NotificationsBell />
                <ProfileMenu />
              </div>
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1680px] flex-1 px-3 py-5 focus:outline-none sm:px-6 sm:py-6"
          >
            <Outlet />
          </main>
        </div>
        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
