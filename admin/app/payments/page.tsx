import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronDown, CircleAlert, IndianRupee, PhoneCall, Search, SearchX, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { PaymentsTable } from '../../components/payments/PaymentsTable';
import { ExportDialog } from '../../components/payments/ExportDialog';
import { formatAmount } from '../../components/payments/format';
import {
  PAGE_SIZE,
  PAYMENT_PERIODS,
  PAYMENT_LISTS,
  PAYMENT_METHOD_FILTERS,
  STAGE_LABELS,
  cleanDate,
  canViewPayments,
  listPayments,
  paymentSummary,
  type PaymentFilters,
  type PaymentPeriod,
  type PaymentList,
  type PaymentMethodFilter,
} from '../../lib/services/payments';
import { Button, ButtonLink, Card, cn, inputClasses, labelClasses } from '../../components/brand';

export const dynamic = 'force-dynamic';

function Metric({ label, value, detail, icon, href }: { label: string; value: string; detail?: string; icon: React.ReactNode; href?: string }) {
  const card = (
    <Card className={cn('flex h-full items-center gap-4 p-4 sm:p-5', href && 'transition-colors hover:border-teal')}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-mist text-teal sm:h-12 sm:w-12">{icon}</div>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink-muted">{label}</p>
        <p className="mt-0.5 font-heading text-[22px] font-semibold leading-tight text-teal sm:text-[24px]">{value}</p>
        {detail && <p className="mt-0.5 text-[13px] text-ink-muted">{detail}</p>}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-card">
      {card}
    </Link>
  ) : (
    card
  );
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; period?: string; method?: string; from?: string; to?: string; q?: string; page?: string; payment?: string }>;
}) {
  const { profile } = await requireStaff();
  // Super admins and coordinators only (RLS enforces the same).
  if (!canViewPayments(profile.role)) redirect('/dashboard');

  const sp = await searchParams;
  const filters: PaymentFilters = {
    status: (PAYMENT_LISTS as string[]).includes(sp.status ?? '') ? (sp.status as PaymentList) : 'all',
    period: PAYMENT_PERIODS.some((p) => p.id === sp.period) ? (sp.period as PaymentPeriod) : 'all',
    method: PAYMENT_METHOD_FILTERS.some((m) => m.id === sp.method) ? (sp.method as PaymentMethodFilter | 'all') : 'all',
    from: cleanDate(sp.from),
    to: cleanDate(sp.to),
    q: (sp.q ?? '').slice(0, 80),
    page: Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1),
  };
  const [{ rows, total }, summary] = await Promise.all([listPayments(filters), paymentSummary()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // What the collapsed "More filters" row filters by (shown in its title; it opens when not empty).
  const day = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const moreFilters = [
    filters.method !== 'all' ? PAYMENT_METHOD_FILTERS.find((m) => m.id === filters.method)?.label : null,
    filters.period !== 'all' ? PAYMENT_PERIODS.find((p) => p.id === filters.period)?.label : null,
    filters.from || filters.to ? `${filters.from ? day(filters.from) : 'start'} – ${filters.to ? day(filters.to) : 'today'}` : null,
  ].filter((v): v is string => !!v);

  const href = (patch: Partial<Record<'status' | 'period' | 'method' | 'from' | 'to' | 'q' | 'page', string>>) => {
    const next = {
      status: filters.status,
      period: filters.period,
      method: filters.method,
      from: filters.from,
      to: filters.to,
      q: filters.q,
      page: String(filters.page),
      ...patch,
    };
    const params = new URLSearchParams();
    if (next.status && next.status !== 'all') params.set('status', next.status);
    if (next.period && next.period !== 'all') params.set('period', next.period);
    if (next.method && next.method !== 'all') params.set('method', next.method);
    if (next.from) params.set('from', next.from);
    if (next.to) params.set('to', next.to);
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
      <PageHeader
        title="Payments"
        description="Assessment purchases: Razorpay, and manual payments recorded on a client's profile. A Razorpay purchase belongs to the number it was paid for until someone logs in with it."
        actions={
          <ExportDialog
            stages={(['all', ...PAYMENT_LISTS] as const).map((s) => ({
              id: s,
              label: STAGE_LABELS[s],
              count: s === 'all' ? Object.values(summary.stages).reduce((a, b) => a + b, 0) : s === 'paid' ? summary.paidCount : summary.stages[s],
            }))}
            periods={PAYMENT_PERIODS}
            initialStatus={filters.status}
            initialPeriod={filters.period}
            extra={{ method: filters.method, from: filters.from, to: filters.to }}
          />
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Metric
          label="Received"
          value={formatAmount(summary.receivedPaise)}
          detail={`${summary.paidCount} paid · ${formatAmount(summary.receivedThisMonthPaise)} this month`}
          icon={<IndianRupee size={22} strokeWidth={2} aria-hidden />}
        />
        <Metric
          label="Paid, not logged in"
          value={String(summary.stages.not_logged_in)}
          detail="Call: log in with the number they paid from"
          href={href({ status: 'not_logged_in', page: '1' })}
          icon={<PhoneCall size={22} strokeWidth={2} aria-hidden />}
        />
        <Metric
          label="Logged in, not started"
          value={String(summary.stages.not_started)}
          detail="Call: press Start on Home"
          href={href({ status: 'not_started', page: '1' })}
          icon={<PhoneCall size={22} strokeWidth={2} aria-hidden />}
        />
        <Metric
          label="Payment not made"
          value={String(summary.stages.not_paid)}
          detail="Tried to pay, did not finish"
          href={href({ status: 'not_paid', page: '1' })}
          icon={<ShoppingCart size={22} strokeWidth={2} aria-hidden />}
        />
      </div>

      {summary.stages.refund_needed > 0 && (
        <Link
          href={href({ status: 'refund_needed', page: '1' })}
          className="mb-6 flex min-h-11 items-center gap-3 rounded-card border border-sand bg-cream p-4 text-[14px] text-ink-soft hover:border-teal"
        >
          <CircleAlert size={20} strokeWidth={2} className="shrink-0 text-coral-deep" aria-hidden />
          <span>
            <span className="font-semibold text-coral-deep">
              {summary.stages.refund_needed} {summary.stages.refund_needed === 1 ? 'refund' : 'refunds'} needed.
            </span>{' '}
            Refund in the Razorpay dashboard, then mark it refunded here.
          </span>
        </Link>
      )}

      {/* Filters */}
      {/* One GET form: search, status chips (links), and the collapsible method / period / date filters. */}
      <Card className="mb-6 p-4">
        <form method="GET" action="/payments" className="space-y-4">
          {filters.status !== 'all' && <input type="hidden" name="status" value={filters.status} />}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={18} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-3.5 top-3.75 text-teal" />
              <input
                type="search"
                name="q"
                aria-label="Search payments"
                defaultValue={filters.q}
                placeholder="Client name, paid-for mobile, email, report ID, Razorpay ID or reference"
                className={`${inputClasses} pl-10`}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" className="flex-1 sm:flex-none">
                Search
              </Button>
              {(filters.q || filters.status !== 'all' || moreFilters.length > 0) && (
                <ButtonLink href="/payments" variant="ghost">
                  Clear
                </ButtonLink>
              )}
            </div>
          </div>

          <nav aria-label="Status" className="flex flex-wrap gap-2">
            {(['all', ...PAYMENT_LISTS] as const).map((s) => (
              <Link key={s} href={href({ status: s, page: '1' })} aria-current={filters.status === s ? 'page' : undefined} className={chip(filters.status === s)}>
                {STAGE_LABELS[s]}
                {s !== 'all' && <span className="ml-1.5 text-[13px] font-normal text-ink-muted">{s === 'paid' ? summary.paidCount : summary.stages[s]}</span>}
              </Link>
            ))}
          </nav>

          {/* Collapsed unless one of these is in use. */}
          <details open={moreFilters.length > 0} className="group rounded-card border border-sand">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[14px] font-semibold text-teal [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal size={16} strokeWidth={2} aria-hidden />
              More filters
              {moreFilters.length > 0 && <span className="truncate font-normal text-ink-muted">· {moreFilters.join(' · ')}</span>}
              <ChevronDown size={16} strokeWidth={2} aria-hidden className="ml-auto shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid grid-cols-1 gap-3 border-t border-sand p-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
              <label className={labelClasses}>
                Method
                <select name="method" defaultValue={filters.method} className={`${inputClasses} mt-1.5 min-h-11`}>
                  {PAYMENT_METHOD_FILTERS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClasses}>
                Period
                <select name="period" defaultValue={filters.period} className={`${inputClasses} mt-1.5 min-h-11`}>
                  {PAYMENT_PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* Date range (India time, both days included): on the date paid, else the date created. */}
              <label className={labelClasses}>
                From
                <input type="date" name="from" defaultValue={filters.from} className={`${inputClasses} mt-1.5 min-h-11`} />
              </label>
              <label className={labelClasses}>
                To
                <input type="date" name="to" defaultValue={filters.to} className={`${inputClasses} mt-1.5 min-h-11`} />
              </label>
              <Button type="submit" variant="secondary" size="sm" className="lg:mb-0.5">
                Apply
              </Button>
            </div>
          </details>
        </form>
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
