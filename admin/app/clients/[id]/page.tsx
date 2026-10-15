import { notFound } from 'next/navigation';
import { UserPlus, User, Shield } from 'lucide-react';
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
const codeClasses =
  'font-mono text-[13px] text-ink-soft bg-cream p-2 rounded-input border border-sand mt-1 break-all select-all';

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

        {/* Detailed Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Demographics Card */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-[20px] font-semibold text-teal mb-4 flex items-center gap-2">
              <User size={18} strokeWidth={2} aria-hidden />
              <span>Demographics</span>
            </h2>

            <dl className="space-y-3.5">
              <div>
                <dt className={dtClasses}>Gender</dt>
                <dd className="text-[16px] font-semibold text-ink mt-0.5">{client.gender}</dd>
              </div>

              <div>
                <dt className={dtClasses}>Age</dt>
                <dd className="text-[16px] font-semibold text-ink mt-0.5">{client.age} years</dd>
              </div>

              <div>
                <dt className={dtClasses}>Relationship status</dt>
                <dd className="text-[16px] font-semibold text-ink mt-0.5">
                  {client.marital_status}
                </dd>
              </div>

              <div>
                <dt className={dtClasses}>Location</dt>
                <dd className="text-[16px] text-ink mt-0.5">
                  {[client.city, client.state].filter(Boolean).join(', ') || 'Not specified'}
                </dd>
              </div>

              <div>
                <dt className={dtClasses}>Email address</dt>
                <dd className="text-[16px] text-ink mt-0.5">{client.email || 'Not provided'}</dd>
              </div>
            </dl>
          </Card>

          {/* System Identity & Association Card */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-[20px] font-semibold text-teal mb-4 flex items-center gap-2">
              <Shield size={18} strokeWidth={2} aria-hidden />
              <span>Identity &amp; security</span>
            </h2>

            <dl className="space-y-3.5">
              <div>
                <dt className={dtClasses}>Application UUID (stable)</dt>
                <dd className={codeClasses}>{client.id}</dd>
              </div>

              <div>
                <dt className={dtClasses}>Auth user ID (auth.users mapping)</dt>
                <dd className={codeClasses}>
                  {client.auth_user_id || 'Not yet linked (awaiting mobile OTP login)'}
                </dd>
              </div>

              <div>
                <dt className={dtClasses}>Created by staff</dt>
                <dd className="text-[15px] text-ink mt-0.5">
                  {client.creator_name ? `${client.creator_name}` : 'Self-registered'}
                </dd>
              </div>

              <div>
                <dt className={dtClasses}>Date registered</dt>
                <dd className="text-[15px] text-ink-muted mt-0.5">
                  {new Date(client.created_at).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </dd>
              </div>
            </dl>
          </Card>
        </div>

        <AttemptsList attempts={attempts} />
    </AdminShell>
  );
}
