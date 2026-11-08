import PaletteOutlined from '@mui/icons-material/PaletteOutlined';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';

import { DashboardCard } from '@/features/dashboard/DashboardCard';
import { useUiStore, type ThemePreference } from '@/stores/uiStore';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

export function AppearanceCard() {
  const preference = useUiStore((s) => s.themePreference);
  const setPreference = useUiStore((s) => s.setThemePreference);
  return (
    <DashboardCard title="Appearance" icon={<PaletteOutlined color="primary" />}>
      <ToggleButtonGroup
        exclusive
        value={preference}
        onChange={(_, value: ThemePreference | null) => {
          if (value) setPreference(value);
        }}
        aria-label="Color theme"
        size="small"
      >
        {OPTIONS.map((o) => (
          <ToggleButton key={o.value} value={o.value}>
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </DashboardCard>
  );
}
