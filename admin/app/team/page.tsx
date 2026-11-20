import { requireSuperAdmin } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { coordinatorClientCounts, listTeam } from '../../lib/services/team';
import { TeamListClient } from './TeamListClient';

export const dynamic = 'force-dynamic';

// Team page (coordinators and counsellors), at /team. /coordinators redirects here.
export default async function TeamPage() {
  const staff = await requireSuperAdmin();
  const { profile } = staff;

  const team = await listTeam();
  const clientCounts = await coordinatorClientCounts(team.filter((m) => m.role === 'coordinator').map((m) => m.id));

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <TeamListClient initialTeam={team} clientCounts={clientCounts} />
    </AdminShell>
  );
}
