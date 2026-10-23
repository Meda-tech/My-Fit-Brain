import Link from 'next/link';
import {
  UserPlus,
  Contact,
  FileText,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  SearchX,
  ClipboardCheck,
  ClipboardList,
} from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { ClientStatusPill } from '../../components/ClientStatusPill';
import { listClients } from '../../lib/services/clients';
import { listTeam } from '../../lib/services/team';
import { attemptCounts } from '../../lib/services/attempts';
import { ROLE_LABELS } from '../../lib/roles';
import { formatDisplayPhone } from '../../lib/phone';
import { ButtonLink, Card } from '../../components/brand';

export const dynamic = 'force-dynamic';

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-mist text-teal sm:h-12 sm:w-12">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink-muted">{label}</p>
        <p className="mt-0.5 font-heading text-[22px] font-semibold sm:text-[26px] leading-tight text-teal">
          {value}
        </p>
        {detail && <p className="mt-0.5 text-[13px] text-ink-muted">{detail}</p>}
      </div>
    </Card>
  );
}

export default async function DashboardPage() {
  const staff = await requireStaff();
  const { profile, isSuperAdmin } = staff;

  const clients = await listClients();
  const team = isSuperAdmin ? await listTeam() : [];
  const assessments = await attemptCounts();

  const myClientsCount = clients.filter(
    (c) => c.created_by_profile_id === profile.id
  ).length;

  const activeTeam = team.filter((m) => m.is_active);
  const activeCoordinators = activeTeam.filter((m) => m.role === 'coordinator').length;
  const activeCounsellors = activeTeam.filter((m) => m.role === 'counsellor').length;
  const recentClients = clients.slice(0, 5);
  // Greet by first name, skipping a leading title such as "Dr" or "Ms".
  const nameParts = profile.full_name.trim().split(/\s+/);
  const firstName =
    nameParts.find((part) => !/^(dr|mr|mrs|ms|miss|prof)\.?$/i.test(part)) || profile.full_name;

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Here is an overview of client records and your team."
        actions={
          <ButtonLink href="/clients/new" variant="primary">
            <UserPlus size={18} strokeWidth={2} aria-hidden />
            <span>New client 21</span>
          </ButtonLink>
        }
      />

      {/* Metric Cards Grid */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
        <MetricCard
          label="Total client records"
          value={clients.length}
          icon={<Contact size={24} strokeWidth={2} aria-hidden />}
        />
        <MetricCard
          label="Created by you"
          value={myClientsCount}
          icon={<FileText size={24} strokeWidth={2} aria-hidden />}
        />
        <MetricCard
          label="Assessments completed"
          value={assessments.completed}
          icon={<ClipboardCheck size={24} strokeWidth={2} aria-hidden />}
        />
        <MetricCard
          label="In progress"
          value={assessments.inProgress}
          detail="Paid, not yet finished"
          icon={<ClipboardList size={24} strokeWidth={2} aria-hidden />}
        />
        {isSuperAdmin ? (
          <MetricCard
            label="Active team"
            value={`${activeTeam.length} / ${team.length}`}
            detail={`${activeCoordinators} ${activeCoordinators === 1 ? 'coordinator' : 'coordinators'} · ${activeCounsellors} ${activeCounsellors === 1 ? 'counsellor' : 'counsellors'}`}
            icon={<ShieldCheck size={24} strokeWidth={2} aria-hidden />}
          />
        ) : (
          <MetricCard
            label="Role status"
            value={<span className="text-[18px]">Active {ROLE_LABELS[profile.role].toLowerCase()}</span>}
            icon={<CheckCircle2 size={24} strokeWidth={2} aria-hidden />}
          />
        )}
      </div>

      {/* Recent Client Records */}
      <Card className="@container overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-sand p-5">
          <div>
            <h2 className="m-0 text-[22px] font-semibold leading-[1.3] text-teal">Recent clients</h2>
            <p className="mt-0.5 text-[14px] text-ink-muted">Client profiles added most recently.</p>
          </div>
          <Link
            href="/clients"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[14px] font-semibold text-teal hover:underline"
          >
            <span>View all</span>
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </Link>
        </div>

        {recentClients.length === 0 ? (
          <div className="p-8 text-center">
            <SearchX size={36} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No client records yet.</p>
            <p className="mx-auto mb-4 mt-1 max-w-sm text-[14px] text-ink-muted">
              Create a client record so the client can sign in with their phone number.
            </p>
            <ButtonLink href="/clients/new" variant="secondary">
              Create client record
            </ButtonLink>
          </div>
        ) : (
          <>
            {/* Mobile: stacked list */}
            <ul className="divide-y divide-sand @3xl:hidden">
              {recentClients.map((client) => (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex items-center gap-3 p-4 transition-colors hover:bg-mist/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{client.full_name}</p>
                      <p className="mt-0.5 font-mono text-[13px] text-ink-soft">
                        {formatDisplayPhone(client.phone)}
                      </p>
                      <div className="mt-2">
                        <ClientStatusPill linked={!!client.auth_user_id} />
                      </div>
                    </div>
                    <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto @3xl:block">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-sand bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Client name</th>
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Phone</th>
                    <th className="whitespace-nowrap hidden px-5 py-3 font-semibold @[60rem]:table-cell">Demographics</th>
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">App login</th>
                    <th className="whitespace-nowrap hidden px-5 py-3 font-semibold @[52rem]:table-cell">Created by</th>
                    <th className="whitespace-nowrap px-5 py-3 text-right font-semibold">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {recentClients.map((client) => (
                    <tr key={client.id} className="transition-colors hover:bg-mist/50">
                      <td className="px-5 py-3.5 font-semibold text-ink">{client.full_name}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[13px] text-ink-soft">
                        {formatDisplayPhone(client.phone)}
                      </td>
                      <td className="hidden px-5 py-3.5 text-ink-soft @[60rem]:table-cell whitespace-nowrap">
                        {client.gender}, {client.age} yrs · {client.marital_status}
                      </td>
                      <td className="px-5 py-3.5">
                        <ClientStatusPill linked={!!client.auth_user_id} />
                      </td>
                      <td className="hidden px-5 py-3.5 text-ink-muted @[52rem]:table-cell whitespace-nowrap">
                        {client.creator_name || 'Direct / System'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/clients/${client.id}`}
                          className="inline-flex min-h-11 items-center gap-0.5 text-[14px] font-semibold text-teal hover:underline"
                        >
                          <span>View</span>
                          <ChevronRight size={16} strokeWidth={2} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </AdminShell>
  );
}
