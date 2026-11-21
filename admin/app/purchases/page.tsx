import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { ShoppingBag } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, cn } from '../../components/brand';
import { PurchasePanel } from '../../components/purchases/PurchasePanel';
import { PurchaseStatusPill } from '../../components/purchases/PurchasePills';
import { formatAmount, formatDate, formatDateTime, formatTime } from '../../components/payments/format';
import { JOURNEY_STAGE_LABELS, PURCHASE_TABS, PURCHASE_TAB_LABELS, defaultPurchaseTab, isPurchaseTab, type PurchaseTab } from '../../lib/purchases';
import { CALL_KIND_LABELS, isCallLate, outcomeLabel } from '../../lib/calls';
import { presentationLabel } from '../../lib/booking';
import { listPackagePurchases, type PackagePurchaseRow } from '../../lib/services/packages';
import {
  PURCHASE_PAGE_SIZE,
  canViewPurchases,
  getPurchase,
  listPurchases,
  purchaseTabCounts,
  syncCalls,
  type PurchaseRow,
} from '../../lib/services/purchases';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stageText(r: PurchaseRow): string {
  if (r.status === 'not_paid') return JOURNEY_STAGE_LABELS.payment;
  if (r.status !== 'paid') return '—';
  if (r.current_stage === 'assessment') {
    return r.assessment_progress === 'in_progress' ? 'Assessment started' : 'Assessment not started';
  }
  return r.current_stage ? JOURNEY_STAGE_LABELS[r.current_stage] : 'All done';
}

/** The time a row is listed by: the latest try while unpaid, else the paid time. */
function rowTime(r: PurchaseRow): string {
  return r.status === 'not_paid' ? r.last_tried_at : r.paid_at ?? r.created_at;
}

function triesText(n: number): string {
  return `${n} ${n === 1 ? 'try' : 'tries'}`;
}

/**
 * The booked report presentation (step 4: counsellor, date and time), "Presentation done <date>" once marked
 * (step 5), and the Package call's result once it is closed (an open one shows in the Call column).
 */
function PresentationLine({ r }: { r: PurchaseRow }) {
  if (!r.presentation) return null;
  const p = r.presentation;
  return (
    <>
      <span className="block text-[12px] font-medium text-teal">
        {p.done_at
          ? `Presentation done ${formatDate(p.done_at)}${p.counsellor_name ? ` by ${p.counsellor_name}` : ''}`
          : `Presentation: ${p.counsellor_name ?? 'Counsellor'}, ${presentationLabel(p.on_date, p.start_time, p.end_time)}`}
      </span>
      {r.package_call?.status === 'closed' && r.package_call.outcome && (
        <span className="block text-[12px] font-medium text-ink">Package call: {outcomeLabel('package', r.package_call.outcome)}</span>
      )}
    </>
  );
}

/** The open call and its due time; coral-deep when late. */
function CallDue({ r, now }: { r: PurchaseRow; now: Date }) {
  if (!r.open_call) return <span className="text-ink-muted">—</span>;
  const late = isCallLate(r.open_call.due_at, now);
  return (
    <span className={cn('block', late && 'font-semibold text-coral-deep')}>
      {CALL_KIND_LABELS[r.open_call.kind]}
      <span className={cn('block text-[12px]', late ? 'text-coral-deep' : 'text-ink-muted')}>
        {late ? 'Late · ' : 'Due '}
        {formatDateTime(r.open_call.due_at)}
      </span>
    </span>
  );
}

const EMPTY: Record<PurchaseTab, string> = {
  unpaid: 'No unpaid tries.',
  paid: 'No purchases yet.',
  all: 'No purchases yet.',
};

const TH = 'px-4 py-3 font-semibold';
const TD = 'px-4 py-3';

// Purchases. Tabs: Unpaid (tries on the pay page that are not paid: payment attempts, also those closed as Not
// interested) · Paid (paid, also refunded or cancelled later) · All. When a number pays, its row moves from Unpaid to
// Paid by itself, with the same coordinator. Each row shows its open call and due time. Super admins see all rows; a
// coordinator only the rows of their own clients (RLS). A row opens a right-side panel.
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; open?: string }>;
}) {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) redirect('/dashboard');
  const sp = await searchParams;
  // The 30-minute rule (Payment calls, package tries) runs after the page is sent, off the page's critical path:
  // a call that reaches its 30 minutes shows on the next load. Paid / completed / booked are instant (triggers).
  after(syncCalls);
  // Type "Package" (super admins only): the paid packages. Coordinators never see them here.
  const superAdmin = profile.role === 'super_admin';
  const packageTab = superAdmin && sp.tab === 'package';
  // The tab counts are needed first only when a coordinator opens the page without a tab (their start tab depends
  // on the Unpaid count); otherwise the counts and the list are read at the same time.
  const countsFirst = !isPurchaseTab(sp.tab) && !packageTab && profile.role === 'coordinator' ? await purchaseTabCounts() : null;
  const tab: PurchaseTab = isPurchaseTab(sp.tab) ? sp.tab : defaultPurchaseTab(profile.role, countsFirst?.unpaid ?? 0);
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const [counts, { rows, total }, open, packages] = await Promise.all([
    countsFirst ?? purchaseTabCounts(),
    packageTab ? Promise.resolve({ rows: [] as PurchaseRow[], total: 0 }) : listPurchases(tab, page),
    sp.open && UUID.test(sp.open) ? getPurchase(sp.open) : Promise.resolve(null),
    superAdmin ? listPackagePurchases() : Promise.resolve([] as PackagePurchaseRow[]),
  ]);
  const now = new Date();
  const pages = Math.max(1, Math.ceil(total / PURCHASE_PAGE_SIZE));
  const href = (params: { tab?: PurchaseTab; page?: number; open?: string }) => {
    const q = new URLSearchParams({ tab: params.tab ?? tab });
    if ((params.page ?? 1) > 1) q.set('page', String(params.page));
    if (params.open) q.set('open', params.open);
    return `/purchases?${q}`;
  };
  const openHref = (id: string) => href({ page, open: id });
  const coordinator = profile.role === 'coordinator';
  const unpaidTab = tab === 'unpaid';

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Purchases"
        description={
          coordinator
            ? 'Purchases and unpaid tries of your clients. Open one to see more.'
            : 'Every purchase, and tries on the pay page that are not paid yet. Open one to see more.'
        }
      />

      <Card className="overflow-hidden">
        <nav aria-label="Purchases" className="flex gap-1 overflow-x-auto border-b border-sand px-2 sm:px-3">
          {PURCHASE_TABS.map((t) => (
            <Link
              key={t}
              href={href({ tab: t })}
              aria-current={t === tab && !packageTab ? 'page' : undefined}
              className={cn(
                'flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[15px] font-semibold',
                t === tab && !packageTab ? 'border-teal text-teal' : 'border-transparent text-ink-muted hover:text-teal'
              )}
            >
              {PURCHASE_TAB_LABELS[t]}
              <span className={cn('rounded-full px-2 text-[12px] leading-5', t === tab && !packageTab ? 'bg-mist text-teal' : 'bg-cream text-ink-muted')}>
                {counts[t]}
              </span>
            </Link>
          ))}
          {superAdmin && (
            <Link
              href="/purchases?tab=package"
              aria-current={packageTab ? 'page' : undefined}
              className={cn(
                'ml-auto flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[15px] font-semibold',
                packageTab ? 'border-teal text-teal' : 'border-transparent text-ink-muted hover:text-teal'
              )}
            >
              Package
              <span className={cn('rounded-full px-2 text-[12px] leading-5', packageTab ? 'bg-mist text-teal' : 'bg-cream text-ink-muted')}>
                {packages.length}
              </span>
            </Link>
          )}
        </nav>

        {packageTab ? (
          <PackagePurchases rows={packages} />
        ) : rows.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <ShoppingBag size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">{EMPTY[tab]}</p>
          </div>
        ) : (
          <>
            {/* Phones, tablets and laptops: cards */}
            <ul className="divide-y divide-sand xl:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={openHref(r.id)}
                    scroll={false}
                    className={cn('grid gap-1 p-4 hover:bg-cream sm:px-5', open?.id === r.id && 'bg-mist')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 font-semibold text-ink">{r.client_name ?? r.phone}</p>
                        {r.client_name && <p className="m-0 font-mono text-[12px] text-ink-muted">{r.phone}</p>}
                      </div>
                      <PurchaseStatusPill status={r.status} notInterested={r.not_interested} />
                    </div>
                    <p className="m-0 text-[14px] text-ink-soft">
                      {r.test_name} ·{' '}
                      {r.status === 'not_paid'
                        ? `${triesText(r.tries)}, last ${formatDate(rowTime(r))}, ${formatTime(rowTime(r))}`
                        : `${formatAmount(r.amount_paise)} · ${formatDate(rowTime(r))} · Now: ${stageText(r)}`}
                    </p>
                    <PresentationLine r={r} />
                    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 text-[13px]">
                      <span className="text-ink-muted">Coordinator: {r.coordinator_name ?? 'None yet'}</span>
                      {r.open_call && (
                        <span className="text-right">
                          <CallDue r={r} now={now} />
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Wide screens: table */}
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  <tr>
                    <th className={TH}>{unpaidTab ? 'Tried' : 'Date'}</th>
                    <th className={TH}>Client</th>
                    <th className={TH}>Assessment</th>
                    {unpaidTab ? (
                      <>
                        <th className={TH}>Tries</th>
                        <th className={TH}>Status</th>
                      </>
                    ) : (
                      <>
                        <th className={TH}>Amount</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Stage now</th>
                      </>
                    )}
                    <th className={TH}>Call</th>
                    <th className={TH}>Coordinator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {rows.map((r) => (
                    <tr key={r.id} className={cn('relative hover:bg-cream', open?.id === r.id && 'bg-mist')}>
                      <td className={cn(TD, 'whitespace-nowrap')}>
                        {/* The link covers the whole row. */}
                        <Link href={openHref(r.id)} scroll={false} className="after:absolute after:inset-0" aria-label={`Open ${r.client_name ?? r.phone}`}>
                          {formatDate(rowTime(r))}
                        </Link>
                        <span className="block text-[12px] text-ink-muted">{formatTime(rowTime(r))}</span>
                      </td>
                      <td className={TD}>
                        <span className="font-medium text-ink">{r.client_name ?? 'Not registered yet'}</span>
                        <span className="block font-mono text-[12px] text-ink-muted">{r.phone}</span>
                      </td>
                      <td className={TD}>{r.test_name}</td>
                      {unpaidTab ? (
                        <td className={cn(TD, 'whitespace-nowrap')}>{triesText(r.tries)}</td>
                      ) : (
                        <td className={cn(TD, 'whitespace-nowrap')}>{formatAmount(r.amount_paise)}</td>
                      )}
                      <td className={TD}>
                        <PurchaseStatusPill status={r.status} notInterested={r.not_interested} />
                      </td>
                      {!unpaidTab && (
                        <td className={TD}>
                          {stageText(r)}
                          <PresentationLine r={r} />
                        </td>
                      )}
                      <td className={TD}>
                        <CallDue r={r} now={now} />
                      </td>
                      <td className={TD}>{r.coordinator_name ?? <span className="text-ink-muted">None yet</span>}</td>
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
              <Link href={href({ page: page - 1 })} className="flex min-h-11 items-center font-medium text-teal hover:underline">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={href({ page: page + 1 })} className="flex min-h-11 items-center font-medium text-teal hover:underline">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>

      {open && <PurchasePanel purchase={open} closeHref={href({ page })} now={now} canCancelBooking={profile.role === 'super_admin'} />}
    </AdminShell>
  );
}

// Type "Package" (super admins): each paid package with its client, amount and the assessment purchase it belongs to.
function PackagePurchases({ rows }: { rows: PackagePurchaseRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="p-10 text-center sm:p-12">
        <ShoppingBag size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
        <p className="text-[16px] font-medium text-ink">No packages paid yet.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-sand">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="m-0 font-semibold text-ink">
              {r.client_name ?? r.phone}
              {r.client_name && <span className="ml-2 font-mono text-[12px] font-normal text-ink-muted">{r.phone}</span>}
            </p>
            <p className="m-0 text-[14px] text-ink-soft">
              Package{r.package_name ? `: ${r.package_name}` : ''}
              {r.sessions ? `, ${r.sessions} sessions` : ''} · {formatAmount(r.amount_paise)} · {r.source === 'manual' ? 'manual payment' : 'Razorpay'}
            </p>
            <p className="m-0 text-[13px] text-ink-muted">
              Paid {formatDateTime(r.paid_at)} · Coordinator: {r.coordinator_name ?? 'None yet'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <PurchaseStatusPill status={r.status === 'refunded' ? 'refunded' : r.status === 'cancelled' ? 'cancelled' : 'paid'} />
            <Link href={`/purchases?tab=paid&open=${r.parent_purchase_id}`} className="flex min-h-11 items-center text-[14px] font-semibold text-teal hover:underline">
              Assessment purchase
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
