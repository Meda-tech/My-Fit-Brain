import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Package } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, cn } from '../../components/brand';
import { CrmFilter } from '../../components/crm/CrmFilter';
import { CRM_NOT_ASSIGNED } from '../../lib/roles';
import { CrmPackagePanel } from '../../components/crm/CrmPackagePanel';
import { formatAmount, formatDate } from '../../components/payments/format';
import { milestoneLabel } from '../../lib/package';
import { canViewCrm, crmPackagePayments, listCrmPackages, listCrmStaff, type CrmPackageRow } from '../../lib/services/crm';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TH = 'px-4 py-3 font-semibold';
const TD = 'px-4 py-3';

function nextLabel(r: CrmPackageRow): string {
  return milestoneLabel(r.remaining_paise > 0 && r.next_paid_paise !== null ? { session: r.next_session, paid_paise: r.next_paid_paise } : null);
}

// CRM (owner, 2026-11-24): the packages that have started (paid in total reached the start amount), handed over by
// the coordinators. A CRM person sees only their own clients; super admins see all, with a CRM filter. Each row:
// client, phone, package, started on, paid so far, remaining, next milestone. A row opens a right-side panel with the
// package payments and their proof links. No session features yet. Nothing from the assessment is shown: the database
// gives a CRM login only these fields (crm_packages()) and the package payments of their own clients.
export default async function CrmPage({ searchParams }: { searchParams: Promise<{ crm?: string; open?: string }> }) {
  const { profile } = await requireStaff();
  if (!canViewCrm(profile.role)) redirect('/dashboard');
  const sp = await searchParams;
  const superAdmin = profile.role === 'super_admin';
  const crmFilter = superAdmin && sp.crm && (UUID.test(sp.crm) || sp.crm === CRM_NOT_ASSIGNED) ? sp.crm : '';

  const [all, staff] = await Promise.all([listCrmPackages(), superAdmin ? listCrmStaff() : Promise.resolve([])]);
  const rows = all.filter((r) => !crmFilter || (crmFilter === CRM_NOT_ASSIGNED ? !r.crm_id : r.crm_id === crmFilter));
  const open = sp.open && UUID.test(sp.open) ? all.find((r) => r.id === sp.open) ?? null : null;
  const payments = open ? await crmPackagePayments(open.parent_purchase_id) : [];

  const href = (openId?: string) => {
    const q = new URLSearchParams();
    if (crmFilter) q.set('crm', crmFilter);
    if (openId) q.set('open', openId);
    return q.size ? `/crm?${q}` : '/crm';
  };

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="CRM"
        description={superAdmin ? 'Every package that has started. Pick a CRM person to see theirs.' : 'The packages of your clients. Open one to see its payments.'}
      />
      {superAdmin && (
        <div className="mb-5">
          <CrmFilter staff={staff} value={crmFilter} showNotAssigned={all.some((r) => !r.crm_id)} />
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-sand p-4 sm:p-5">
          <p className="m-0 text-[16px] font-semibold text-teal">
            {rows.length} {rows.length === 1 ? 'package' : 'packages'}
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <Package size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No packages have started yet.</p>
            <p className="mt-1 text-[14px] text-ink-muted">A package shows here once the client has paid the start amount.</p>
          </div>
        ) : (
          <>
            {/* Phones, tablets and laptops: cards */}
            <ul className="divide-y divide-sand xl:hidden">
              {rows.map((r) => (
                <li key={r.id} className={cn('relative grid gap-1 p-4 hover:bg-cream sm:px-5', open?.id === r.id && 'bg-mist')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* The link covers the whole card. */}
                      <Link href={href(r.id)} scroll={false} className="font-semibold text-ink after:absolute after:inset-0">
                        {r.client_name ?? 'Not registered yet'}
                      </Link>
                      <p className="m-0 font-mono text-[12px] text-ink-muted">{r.phone}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-mist px-2.5 py-0.5 text-[12px] font-semibold leading-4.5 text-teal">{nextLabel(r)}</span>
                  </div>
                  <p className="m-0 text-[14px] text-ink-soft">
                    {r.package_name ?? 'Package'}
                    {r.sessions ? `, ${r.sessions} sessions` : ''} · Started {formatDate(r.started_at)}
                  </p>
                  <p className="m-0 text-[14px] text-ink">
                    Paid {formatAmount(r.paid_paise)} of {formatAmount(r.total_paise)} · Remaining {formatAmount(r.remaining_paise)}
                  </p>
                  {superAdmin && <p className="m-0 text-[13px] text-ink-muted">CRM: {r.crm_name ?? 'Not assigned yet'}</p>}
                </li>
              ))}
            </ul>

            {/* Wide screens: table */}
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  <tr>
                    {['Client', 'Phone', 'Package', 'Started on', 'Paid so far', 'Remaining', 'Next milestone', ...(superAdmin ? ['CRM'] : [])].map((h) => (
                      <th key={h} className={TH}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {rows.map((r) => (
                    <tr key={r.id} className={cn('relative align-top hover:bg-cream', open?.id === r.id && 'bg-mist')}>
                      <td className={TD}>
                        <Link href={href(r.id)} scroll={false} className="font-medium text-ink after:absolute after:inset-0 hover:text-teal">
                          {r.client_name ?? 'Not registered yet'}
                        </Link>
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap font-mono text-[13px]')}>{r.phone}</td>
                      <td className={TD}>
                        {r.package_name ?? 'Package'}
                        {r.sessions ? <span className="block text-[12px] text-ink-muted">{r.sessions} sessions</span> : null}
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap')}>{formatDate(r.started_at)}</td>
                      <td className={cn(TD, 'whitespace-nowrap font-medium text-teal')}>{formatAmount(r.paid_paise)}</td>
                      <td className={cn(TD, 'whitespace-nowrap')}>{formatAmount(r.remaining_paise)}</td>
                      <td className={TD}>{nextLabel(r)}</td>
                      {superAdmin && <td className={TD}>{r.crm_name ?? <span className="text-ink-muted">Not assigned yet</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {open && <CrmPackagePanel pkg={open} payments={payments} closeHref={href()} showCrm={superAdmin} />}
    </AdminShell>
  );
}
