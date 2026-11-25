import { requireSuperAdmin } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { coordinatorClientCounts, counsellorClientCounts, crmClientCounts, listTeam } from '../../lib/services/team';
import { TeamListClient } from './TeamListClient';

export const dynamic = 'force-dynamic';

// Team page (coordinators, counsellors and CRM), at /team. /coordinators redirects here.
export default async function TeamPage() {
  const staff = await requireSuperAdmin();
  const { profile } = staff;

  const team = await listTeam();
  const ids = (role: string) => team.filter((m) => m.role === role).map((m) => m.id);
  const [coordinatorCounts, counsellorCounts, crmCounts] = await Promise.all([
    coordinatorClientCounts(ids('coordinator')),
    counsellorClientCounts(ids('counsellor')),
    crmClientCounts(ids('crm')),
  ]);

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <TeamListClient initialTeam={team} clientCounts={{ ...coordinatorCounts, ...counsellorCounts, ...crmCounts }} />
    </AdminShell>
  );
}
