import { requireSuperAdmin } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { coordinatorClientCounts, counsellorClientCounts, listTeam } from '../../lib/services/team';
import { TeamListClient } from './TeamListClient';

export const dynamic = 'force-dynamic';

// Team page (coordinators and counsellors), at /team. /coordinators redirects here.
export default async function TeamPage() {
  const staff = await requireSuperAdmin();
  const { profile } = staff;

  const team = await listTeam();
  const ids = (role: string) => team.filter((m) => m.role === role).map((m) => m.id);
  const [coordinatorCounts, counsellorCounts] = await Promise.all([
    coordinatorClientCounts(ids('coordinator')),
    counsellorClientCounts(ids('counsellor')),
  ]);

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <TeamListClient initialTeam={team} clientCounts={{ ...coordinatorCounts, ...counsellorCounts }} />
    </AdminShell>
  );
}
