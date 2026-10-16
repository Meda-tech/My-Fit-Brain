import { notFound } from 'next/navigation';
import { UserPlus, User } from 'lucide-react';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { ClientStatusPill } from '../../../components/ClientStatusPill';
import { getClientById } from '../../../lib/services/clients';
import { listClientAttempts } from '../../../lib/services/attempts';
import { AttemptsList } from '../../../components/attempts/AttemptsList';
import { formatDisplayPhone } from '../../../lib/phone';
import { ButtonLink, Card, Pill } from '../../../components/brand';

export const dynamic = 'force-dynamic';

interface ClientDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

const dtClasses = 'text-[12px] font-medium text-ink-muted uppercase tracking-[0.06em]';
const ddClasses = 'mt-0.5 text-[16px] text-ink';

// Server time is UTC once deployed; staff read India time.
function formatIndiaDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const staff = await requireStaff();
  const { profile } = staff;
  const { id } = await params;

  const client = await getClientById(id);
  if (!client) {
    notFound();
  }

  const isLinked = !!client.auth_user_id;
  const attempts = await listClientAttempts(client.id);

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        back={{ href: '/clients', label: 'Back to client records' }}
        eyebrow={
          <>
            <Pill tone="quiet">Client profile</Pill>
            <ClientStatusPill linked={isLinked} />
          </>
        }
        title={client.full_name}
        description={
          <>
            Mobile: <span className="font-mono">{formatDisplayPhone(client.phone)}</span>
          </>
        }
        actions={
          <ButtonLink href="/clients/new" variant="secondary">
            <UserPlus size={18} strokeWidth={2} aria-hidden />
            <span>New client</span>
          </ButtonLink>
        }
      />

        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-[20px] font-semibold text-teal">
            <User size={18} strokeWidth={2} aria-hidden />
            <span>Client details</span>
          </h2>

          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className={dtClasses}>Gender</dt>
              <dd className={ddClasses}>{client.gender}</dd>
            </div>
            <div>
              <dt className={dtClasses}>Age</dt>
              <dd className={ddClasses}>{client.age} years</dd>
            </div>
            <div>
              <dt className={dtClasses}>Relationship status</dt>
              <dd className={ddClasses}>{client.marital_status}</dd>
            </div>
            <div>
              <dt className={dtClasses}>Location</dt>
              <dd className={ddClasses}>{[client.city, client.state].filter(Boolean).join(', ') || 'Not specified'}</dd>
            </div>
            <div>
              <dt className={dtClasses}>Email address</dt>
              <dd className={`${ddClasses} wrap-break-word`}>{client.email || 'Not provided'}</dd>
            </div>
            <div>
              <dt className={dtClasses}>Client ID</dt>
              <dd className="mt-0.5 select-all break-all font-mono text-[13px] text-ink-soft">{client.id}</dd>
            </div>
            <div>
              <dt className={dtClasses}>Created by</dt>
              <dd className={ddClasses}>{client.created_by_profile_id
                  ? client.creator_name ?? 'Staff member'
                  : 'Self-registered (phone sign-in)'}</dd>
            </div>
            <div>
              <dt className={dtClasses}>Registered on</dt>
              <dd className={ddClasses}>{formatIndiaDateTime(client.created_at)}</dd>
            </div>
          </dl>
        </Card>

        <AttemptsList attempts={attempts} />
    </AdminShell>
  );
}
