import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { CreateClientForm } from './CreateClientForm';

export const dynamic = 'force-dynamic';

export default async function NewClientPage() {
  const staff = await requireStaff();
  const { profile } = staff;

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
