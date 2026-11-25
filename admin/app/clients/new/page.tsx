import { redirect } from 'next/navigation';
import { requireStaff } from '../../../lib/auth';
import { CRM_HOME, isCrm } from '../../../lib/roles';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { CreateClientForm } from './CreateClientForm';

export const dynamic = 'force-dynamic';

export default async function NewClientPage() {
  const staff = await requireStaff();
  const { profile } = staff;
  // Counsellors add no clients (they see only their own; the database refuses it too).
  if (profile.role === 'counsellor') redirect('/clients');
  if (isCrm(profile.role)) redirect(CRM_HOME);

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <div className="mx-auto max-w-190">
        <PageHeader
          back={{ href: '/clients', label: 'Back to clients' }}
          title="Create client record"
          description="Pre-register a client. When the client signs in with this mobile number, their account links to this record."
        />
        <CreateClientForm />
      </div>
    </AdminShell>
  );
}
