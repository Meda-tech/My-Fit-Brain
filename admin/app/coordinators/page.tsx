import { requireSuperAdmin } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { listTeam } from '../../lib/services/team';
import { TeamListClient } from './TeamListClient';

export const dynamic = 'force-dynamic';

// Team page (coordinators and counsellors). Route stays /coordinators so links keep working.
export default async function TeamPage() {
  const staff = await requireSuperAdmin();
  const { profile } = staff;

  const team = await listTeam();

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <TeamListClient initialTeam={team} />
    </AdminShell>
  );
}
