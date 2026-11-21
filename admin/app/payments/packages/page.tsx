import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { Card, cn } from '../../../components/brand';
import { PaymentKindSwitch } from '../../../components/payments/PaymentKindSwitch';
import { formatAmount, formatDateTime, paymentMethodLabel } from '../../../components/payments/format';
import { PACKAGE_PAYMENT_STATE_LABELS, packagePaymentState, type PackagePaymentState } from '../../../lib/package';
import { canViewPayments } from '../../../lib/services/payments';
import { PACKAGE_PAYMENTS_PAGE_SIZE, listPackagePayments, type PackagePaymentRow } from '../../../lib/services/packages';

export const dynamic = 'force-dynamic';

const PILL = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-4.5';
const STATE_CLASSES: Record<PackagePaymentState, string> = {
  paid: 'bg-mist text-teal',
  refund_needed: 'border border-coral-deep text-coral-deep',
  refunded: 'border border-sand bg-cream text-ink-soft',
  failed: 'border border-sand bg-cream text-ink-soft',
  not_completed: 'border border-sand bg-cream text-ink-muted',
};

function StatePill({ p }: { p: PackagePaymentRow }) {
  const state = packagePaymentState(p);
  return <span className={cn(PILL, STATE_CLASSES[state])}>{PACKAGE_PAYMENT_STATE_LABELS[state]}</span>;
}

function Details({ p }: { p: PackagePaymentRow }) {
  const manual = p.provider === 'offline';
  return (
    <>
      <span className="block">
        {manual && <span className={cn(PILL, 'mr-1.5 bg-teal text-white')}>Manual</span>}
        {paymentMethodLabel(p)}
      </span>
      <span className="block font-mono text-[12px] text-ink-muted">{manual ? p.reference : p.provider_payment_id ?? '—'}</span>
      {manual && (
        <span className="block text-[12px] text-ink-muted">
          Verified by coordinator: {p.recorded_by_name ?? '—'} · Accounts check: {p.accounts_check === 'checked' ? 'Checked' : 'Pending'}
          {p.proof_url && (
            <>
              {' '}
              ·{' '}
              <a href={p.proof_url} target="_blank" rel="noreferrer" className="font-medium text-teal hover:underline">
                Proof
              </a>
            </>
          )}
        </span>
      )}
    </>
  );
}

// Package payments (step 6): every package payment try and manual package payment, newest first. Super admins see
// all; a coordinator sees only their own clients' (RLS). The amount is always package price − assessment amount paid.
export default async function PackagePaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) redirect('/dashboard');
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const { rows, total } = await listPackagePayments(page);
  const pages = Math.max(1, Math.ceil(total / PACKAGE_PAYMENTS_PAGE_SIZE));
  const pageHref = (p: number) => (p > 1 ? `/payments/packages?page=${p}` : '/payments/packages');

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Payments"
        description={profile.role === 'coordinator' ? 'Package payments of your clients.' : 'Every package payment: Razorpay tries and manual payments.'}
      />
      <PaymentKindSwitch current="package" />

      <Card className="overflow-hidden">
        <div className="border-b border-sand p-4 sm:p-5">
          <p className="m-0 text-[16px] font-semibold text-teal">
            {total} {total === 1 ? 'package payment' : 'package payments'}
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <CreditCard size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No package payments yet.</p>
          </div>
        ) : (
          <>
            {/* Phones, tablets and laptops: cards */}
            <ul className="divide-y divide-sand xl:hidden">
              {rows.map((p) => (
                <li key={p.id} className="grid gap-1 p-4 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 font-semibold text-ink">{p.client_name ?? p.phone}</p>
                      {p.client_name && <p className="m-0 font-mono text-[12px] text-ink-muted">{p.phone}</p>}
                    </div>
                    <StatePill p={p} />
                  </div>
                  <p className="m-0 text-[14px] text-ink-soft">
                    {formatAmount(p.amount_paise)} · {p.package_name}, {p.sessions} sessions · {formatDateTime(p.paid_at ?? p.created_at)}
                  </p>
                  <div className="text-[14px] text-ink-soft">
                    <Details p={p} />
                  </div>
                  <p className="m-0 text-[13px] text-ink-muted">
                    Coordinator: {p.coordinator_name ?? 'None yet'} ·{' '}
                    <Link href={`/purchases?tab=paid&open=${p.purchase_id}`} className="font-medium text-teal hover:underline">
                      Open purchase
                    </Link>
                  </p>
                </li>
              ))}
            </ul>

            {/* Wide screens: table */}
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  <tr>
                    {['Date', 'Client', 'Package', 'Amount', 'Status', 'Method and reference', 'Coordinator'].map((h) => (
                      <th key={h} className="px-4 py-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {rows.map((p) => (
                    <tr key={p.id} className="align-top hover:bg-cream">
                      <td className="whitespace-nowrap px-4 py-3">{formatDateTime(p.paid_at ?? p.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/purchases?tab=paid&open=${p.purchase_id}`} className="font-medium text-ink hover:text-teal hover:underline">
                          {p.client_name ?? 'Not registered yet'}
                        </Link>
                        <span className="block font-mono text-[12px] text-ink-muted">{p.phone}</span>
                      </td>
                      <td className="px-4 py-3">
                        {p.package_name}
                        <span className="block text-[12px] text-ink-muted">{p.sessions} sessions</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{formatAmount(p.amount_paise)}</td>
                      <td className="px-4 py-3">
                        <StatePill p={p} />
                      </td>
                      <td className="px-4 py-3">
                        <Details p={p} />
                      </td>
                      <td className="px-4 py-3">{p.coordinator_name ?? <span className="text-ink-muted">None yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-sand p-4 text-[14px]">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="flex min-h-11 items-center font-medium text-teal hover:underline">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="flex min-h-11 items-center font-medium text-teal hover:underline">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
    </AdminShell>
  );
}
