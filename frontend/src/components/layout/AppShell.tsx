import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { useAuthState, useLogout } from '@/api/auth';
import { ConnectionBanner } from '@/components/feedback/ConnectionBanner';
import { useUiStore } from '@/stores/uiStore';

import { BrandMark } from './BrandMark';
import { isAvailable, NAV_SECTIONS } from './navigation';
import { WorkspaceSelector } from './WorkspaceSelector';

const DRAWER_WIDTH = 272;

function NavigationList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Box
      component="nav"
      aria-label="Main navigation"
      sx={{ px: 1.5, pb: 2, overflowY: 'auto', flexGrow: 1, minHeight: 0 }}
    >
      {NAV_SECTIONS.map((section) => (
        <List
          key={section.title}
          dense
          subheader={
            <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '36px' }}>
              {section.title}
            </ListSubheader>
          }
        >
          {section.items.map((item) => {
            const Icon = item.icon;
            return (
              <ListItemButton
                key={item.path}
                component={NavLink}
                to={item.path}
                end={item.path === '/'}
                onClick={onNavigate}
                sx={{ mb: 0.25 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={item.label} />
                {!isAvailable(item) && (
                  <Chip
                    label={`P${item.phase}`}
                    size="small"
                    variant="outlined"
                    aria-label={`Planned for phase ${item.phase}`}
                    sx={{ height: 20, fontSize: 11 }}
                  />
                )}
              </ListItemButton>
            );
          })}
        </List>
      ))}
    </Box>
  );
}

function DrawerContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ gap: 1.5 }}>
        <BrandMark />
        <Typography variant="h6" component="span" noWrap>
          Personal OS
        </Typography>
      </Toolbar>
      <Box sx={{ px: 2, pb: 1 }}>
        <WorkspaceSelector />
      </Box>
      <Divider sx={{ mx: 2, my: 1 }} />
      <NavigationList {...(onNavigate && { onNavigate })} />
    </Box>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const setPreference = useUiStore((s) => s.setThemePreference);
  const isDark = theme.palette.mode === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        onClick={() => setPreference(isDark ? 'light' : 'dark')}
        color="inherit"
      >
        {isDark ? <LightModeOutlined /> : <DarkModeOutlined />}
      </IconButton>
    </Tooltip>
  );
}

function UserMenu() {
  const { data } = useAuthState();
  const logout = useLogout();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = data?.user.display_name ?? '';

  const handleLogout = () => {
    setAnchor(null);
    logout.mutate(undefined, { onSettled: () => void navigate('/login', { replace: true }) });
  };

  return (
    <>
      <Tooltip title="Account">
        <IconButton
          aria-label="Open account menu"
          aria-haspopup="menu"
          aria-expanded={anchor ? 'true' : undefined}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
            {name.slice(0, 1).toUpperCase() || '?'}
          </Avatar>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2">{name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {data?.user.email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={handleLogout} disabled={logout.isPending}>
          <ListItemIcon>
            <LogoutRounded fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}

/** Authenticated application frame: responsive navigation drawer + top bar. */
export function AppShell() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const mobileOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileOpen = useUiStore((s) => s.setMobileNavOpen);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute',
          left: -9999,
          '&:focus': { left: 16, top: 16, zIndex: 2000, bgcolor: 'background.paper', p: 1 },
        }}
      >
        Skip to content
      </Box>

      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          <DrawerContent />
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          <DrawerContent onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      )}

      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky">
          <ConnectionBanner />
          <Toolbar sx={{ gap: 1 }}>
            {!isDesktop && (
              <IconButton
                edge="start"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
                color="inherit"
              >
                <MenuRounded />
              </IconButton>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <ThemeToggle />
            <UserMenu />
          </Toolbar>
        </AppBar>
        <Box
          component="main"
          id="main-content"
          tabIndex={-1}
          sx={{
            flexGrow: 1,
            p: { xs: 2, sm: 3, lg: 4 },
            maxWidth: 1440,
            width: '100%',
            mx: 'auto',
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
