import { useAuthState } from '@/api/auth';
import { PageHeader } from '@/components/layout/PageHeader';

import { AiCard } from './AiCard';
import { AuditLogCard } from './AuditLogCard';
import { ChangePasswordCard } from './ChangePasswordCard';
import { MfaCard } from './MfaCard';
import { SessionsCard } from './SessionsCard';

export function SettingsPage() {
  const { data } = useAuthState();
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="System"
        title="Settings & Security"
        subtitle="Authentication, active sessions and recent security activity."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <MfaCard />
        <ChangePasswordCard />
        <SessionsCard />
        <AiCard />
        <AuditLogCard timeZone={data?.user.timezone ?? 'UTC'} />
      </div>
    </div>
  );
}
