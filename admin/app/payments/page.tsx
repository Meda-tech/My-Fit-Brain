import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CircleAlert, CircleCheck, Clock, IndianRupee, Search, SearchX } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { PaymentsTable } from '../../components/payments/PaymentsTable';
import { formatAmount } from '../../components/payments/format';
import {
  PAGE_SIZE,
  PAYMENT_PERIODS,
  PAYMENT_VIEWS,
  canViewPayments,
  listPayments,
  paymentSummary,
  type PaymentFilters,
  type PaymentPeriod,
  type PaymentView,
} from '../../lib/services/payments';
import { Button, ButtonLink, Card, cn, inputClasses } from '../../components/brand';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<PaymentView | 'all', string> = {
  all: 'All',
  paid: 'Paid',
  not_started: 'Paid, not started',
  refund_needed: 'Refund needed',
  refunded: 'Refunded',
  created: 'Not completed',
  failed: 'Failed',
};

function Metric({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-mist text-teal sm:h-12 sm:w-12">{icon}</div>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink-muted">{label}</p>
        <p className="mt-0.5 font-heading text-[22px] font-semibold leading-tight text-teal sm:text-[24px]">{value}</p>
        {detail && <p className="mt-0.5 text-[13px] text-ink-muted">{detail}</p>}
      </div>
    </Card>
  );
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; period?: string; q?: string; page?: string; payment?: string }>;
}) {
  const { profile } = await requireStaff();
  // Super admins and coordinators only (RLS enforces the same).
  if (!canViewPayments(profile.role)) redirect('/dashboard');

  const sp = await searchParams;
  const filters: PaymentFilters = {
    status: (PAYMENT_VIEWS as string[]).includes(sp.status ?? '') ? (sp.status as PaymentView) : 'all',
    period: PAYMENT_PERIODS.some((p) => p.id === sp.period) ? (sp.period as PaymentPeriod) : 'all',
    q: (sp.q ?? '').slice(0, 80),
    page: Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1),
  };
  const [{ rows, total }, summary] = await Promise.all([listPayments(filters), paymentSummary()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (patch: Partial<Record<'status' | 'period' | 'q' | 'page', string>>) => {
    const next = { status: filters.status, period: filters.period, q: filters.q, page: String(filters.page), ...patch };
    const params = new URLSearchParams();
    if (next.status && next.status !== 'all') params.set('status', next.status);
    if (next.period && next.period !== 'all') params.set('period', next.period);
    if (next.q) params.set('q', next.q);
    if (next.page && next.page !== '1') params.set('page', next.page);
    const qs = params.toString();
    return `/payments${qs ? `?${qs}` : ''}`;
  };

  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] font-medium transition-colors',
      active ? 'border-teal bg-mist font-semibold text-teal' : 'border-sand bg-white text-ink-soft hover:border-teal hover:text-teal'
    );

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader title="Payments" description="Assessment purchases through Razorpay. A purchase belongs to the number it was paid for until someone logs in with it." />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Metric
          label="Received"
          value={formatAmount(summary.receivedPaise)}
          detail={`${summary.paidCount} paid ${summary.paidCount === 1 ? 'payment' : 'payments'}`}
          icon={<IndianRupee size={22} strokeWidth={2} aria-hidden />}
        />
        <Metric
          label="This month"
          value={formatAmount(summary.receivedThisMonthPaise)}
          icon={<CircleCheck size={22} strokeWidth={2} aria-hidden />}
        />
        <Metric
          label="Paid, not started"
          value={String(summary.notStartedCount)}
          detail={`${summary.openCount} checkouts not completed`}
          icon={<Clock size={22} strokeWidth={2} aria-hidden />}
        />
        <Metric
          label="Refund needed"
          value={String(summary.refundNeededCount)}
          detail={`${summary.failedCount} failed`}
          icon={<CircleAlert size={22} strokeWidth={2} aria-hidden />}
        />
      </div>

      {/* Filters */}
      <Card className="mb-6 space-y-4 p-4">
        <form method="GET" action="/payments" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {filters.status !== 'all' && <input type="hidden" name="status" value={filters.status} />}
          {filters.period !== 'all' && <input type="hidden" name="period" value={filters.period} />}
          <div className="relative flex-1">
            <Search size={18} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-3.5 top-3.75 text-teal" />
            <input
              type="search"
              name="q"
              aria-label="Search payments"
              defaultValue={filters.q}
              placeholder="Client name, paid-for mobile, email, report ID or Razorpay ID"
              className={`${inputClasses} pl-10`}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1 sm:flex-none">
              Search
            </Button>
            {(filters.q || filters.status !== 'all' || filters.period !== 'all') && (
              <ButtonLink href="/payments" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Status" className="flex flex-wrap gap-2">
            {(['all', ...PAYMENT_VIEWS] as const).map((s) => (
              <Link key={s} href={href({ status: s, page: '1' })} aria-current={filters.status === s ? 'page' : undefined} className={chip(filters.status === s)}>
                {STATUS_LABELS[s]}
              </Link>
            ))}
          </nav>
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {PAYMENT_PERIODS.map((p) => (
              <Link key={p.id} href={href({ period: p.id, page: '1' })} aria-current={filters.period === p.id ? 'page' : undefined} className={chip(filters.period === p.id)}>
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
      </Card>

      {/* Table */}
      <Card className="@container overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand p-4 sm:p-5">
          <p className="text-[16px] font-semibold text-teal">
            {total} {total === 1 ? 'payment' : 'payments'}
          </p>
          {filters.q && <span className="text-[14px] text-ink-muted">Results for &ldquo;{filters.q}&rdquo;</span>}
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <SearchX size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No payments match.</p>
            <p className="mt-1 text-[14px] text-ink-muted">Payments appear here as soon as someone opens the checkout.</p>
          </div>
        ) : (
          <PaymentsTable rows={rows} initialSelected={sp.payment ?? null} />
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-sand p-4 text-[14px]">
            {filters.page > 1 ? (
              <ButtonLink href={href({ page: String(filters.page - 1) })} variant="ghost" size="sm">
                Previous
              </ButtonLink>
            ) : (
              <span />
            )}
            <span className="text-ink-muted">
              Page {filters.page} of {pages}
            </span>
            {filters.page < pages ? (
              <ButtonLink href={href({ page: String(filters.page + 1) })} variant="ghost" size="sm">
                Next
              </ButtonLink>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
    </AdminShell>
  );
}
