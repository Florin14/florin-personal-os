import { alpha, createTheme, type Theme } from '@mui/material/styles';

export type ColorMode = 'dark' | 'light';

const FONT_STACK = [
  '"Inter Variable"',
  'Inter',
  'system-ui',
  '-apple-system',
  '"Segoe UI"',
  'Roboto',
  'sans-serif',
].join(',');

const palettes = {
  dark: {
    primary: '#8B9CFF',
    secondary: '#3DD6C6',
    background: '#0A0E16',
    paper: '#111725',
    text: '#E7EAF3',
    textSecondary: '#9AA3B8',
    divider: 'rgba(148, 163, 196, 0.14)',
  },
  light: {
    primary: '#4054D6',
    secondary: '#0E9F91',
    background: '#F4F6FB',
    paper: '#FFFFFF',
    text: '#141A2A',
    textSecondary: '#535C72',
    divider: 'rgba(20, 26, 42, 0.10)',
  },
} as const;

/** Builds the design-system theme. Dark mode is the primary design target. */
export function buildTheme(mode: ColorMode, reducedMotion: boolean): Theme {
  const p = palettes[mode];
  const theme = createTheme({
    palette: {
      mode,
      primary: { main: p.primary },
      secondary: { main: p.secondary },
      background: { default: p.background, paper: p.paper },
      text: { primary: p.text, secondary: p.textSecondary },
      divider: p.divider,
      success: { main: mode === 'dark' ? '#4ADE80' : '#15803D' },
      warning: { main: mode === 'dark' ? '#FBBF24' : '#B45309' },
      error: { main: mode === 'dark' ? '#F87171' : '#B91C1C' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_STACK,
      h1: { fontWeight: 700, letterSpacing: '-0.02em' },
      h4: { fontWeight: 700, letterSpacing: '-0.01em' },
      h5: { fontWeight: 650 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
      overline: { letterSpacing: '0.12em', fontWeight: 600 },
    },
    // Respect the user's reduced-motion preference globally.
    ...(reducedMotion ? { transitions: { create: () => 'none' } } : {}),
  });

  const glass =
    mode === 'dark'
      ? {
          backgroundColor: alpha(p.paper, 0.72),
          backdropFilter: 'blur(14px)',
          border: `1px solid ${p.divider}`,
        }
      : { border: `1px solid ${p.divider}` };

  return createTheme(theme, {
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundImage:
              mode === 'dark'
                ? `radial-gradient(1200px 600px at 10% -10%, ${alpha(p.primary, 0.12)}, transparent 60%),` +
                  `radial-gradient(900px 500px at 100% 0%, ${alpha(p.secondary, 0.08)}, transparent 55%)`
                : 'none',
            backgroundAttachment: 'fixed',
          },
          '*:focus-visible': {
            outline: `2px solid ${p.primary}`,
            outlineOffset: 2,
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { ...glass } },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'transparent' },
        styleOverrides: {
          root: {
            backdropFilter: 'blur(12px)',
            backgroundColor: alpha(p.background, 0.7),
            borderBottom: `1px solid ${p.divider}`,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { backgroundColor: p.background, borderRight: `1px solid ${p.divider}` },
        },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiTextField: { defaultProps: { fullWidth: true } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            '&.active': {
              backgroundColor: alpha(p.primary, mode === 'dark' ? 0.16 : 0.1),
              color: p.primary,
              '& .MuiListItemIcon-root': { color: p.primary },
            },
          },
        },
      },
    },
  });
}
