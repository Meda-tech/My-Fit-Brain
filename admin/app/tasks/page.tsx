import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { PhoneCall } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, cn } from '../../components/brand';
import { PurchasePanel } from '../../components/purchases/PurchasePanel';
import { CallDoneButton } from '../../components/calls/CallDoneButton';
import { BookPresentationButton } from '../../components/booking/BookPresentationButton';
import { PackagePaymentDialog } from '../../components/packages/PackagePaymentDialog';
import { OfflinePaymentDialog } from '../../components/payments/OfflinePaymentDialog';
import { TaskFilters } from '../../components/calls/TaskFilters';
import { CALL_KIND_LABELS, TASK_SHOWS, dueLabel, isCallLate, isTaskShow, tasksHref, type TaskShow } from '../../lib/calls';
import { canViewPurchases, getPurchase, syncCalls } from '../../lib/services/purchases';
import { listCoordinators, listTasks } from '../../lib/services/calls';
import { unmarkedPresentations, type PresentationRow } from '../../lib/services/presentations';
import { PresentationDoneButton } from '../../components/presentations/PresentationDoneButton';
import { presentationLabel } from '../../lib/booking';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY: Record<TaskShow, string> = {
  all: 'No calls to make right now.',
  late: 'No late calls.',
  upcoming: 'No upcoming calls.',
  unmarked: 'Every presentation whose time has passed is marked done.',
};

// My tasks: the open Payment and Assessment calls in ONE list by due time, soonest (late) first (owner,
// 2026-11-20). Filters at the top: All · Late only · Upcoming, and the coordinator for super admins. A coordinator
// sees the calls of their own clients; super admins see all. A row opens the same right-side panel as Purchases;
// its button opens Mark as call done.
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ coordinator?: string; show?: string; late?: string; open?: string }>;
}) {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) redirect('/dashboard');
  const sp = await searchParams;
  const superAdmin = profile.role === 'super_admin';
  const coordinatorId = superAdmin && sp.coordinator && UUID.test(sp.coordinator) ? sp.coordinator : '';
  const asked: TaskShow = isTaskShow(sp.show) ? sp.show : sp.late === '1' ? 'late' : 'all';
  const show: TaskShow = asked === 'unmarked' && !superAdmin ? 'all' : asked;

  // The 30-minute rule (Payment calls, package tries) runs after the page is sent, off the page's critical path:
  // a call that reaches its 30 minutes shows on the next load. Paid / completed / booked are instant (triggers).
  after(syncCalls);
  const [tasks, coordinators, open, unmarked] = await Promise.all([
    listTasks({ coordinatorId }),
    superAdmin ? listCoordinators() : Promise.resolve(null),
    sp.open && UUID.test(sp.open) ? getPurchase(sp.open) : Promise.resolve(null),
    superAdmin ? unmarkedPresentations() : Promise.resolve([] as PresentationRow[]),
  ]);

  const now = new Date();
  const inShow = (s: TaskShow) => (t: { due_at: string }) => s !== 'unmarked' && (s === 'all' || (s === 'late') === isCallLate(t.due_at, now));
  const counts = {
    ...(Object.fromEntries(TASK_SHOWS.map((s) => [s, tasks.filter(inShow(s)).length])) as Record<TaskShow, number>),
    unmarked: unmarked.length,
  };
  const rows = tasks.filter(inShow(show));

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="My tasks"
        description={superAdmin ? 'Every open call, soonest first.' : 'The calls to make for your clients, soonest first.'}
      />

      <TaskFilters coordinators={coordinators} coordinatorId={coordinatorId} show={show} counts={counts} showUnmarked={superAdmin} />

      {show === 'unmarked' ? (
        <UnmarkedList rows={unmarked} />
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center sm:p-12">
          <PhoneCall size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
          <p className="text-[16px] font-medium text-ink">{EMPTY[show]}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-sand">
            {rows.map((t) => {
              const late = isCallLate(t.due_at, now);
              return (
                <li
                  key={t.call_id}
                  className={cn(
                    'relative flex flex-col gap-3 p-4 hover:bg-cream sm:flex-row sm:items-center sm:gap-4 sm:px-5',
                    open?.id === t.purchase_id && 'bg-mist'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-teal">{CALL_KIND_LABELS[t.kind]}</p>
                    {/* The link covers the whole row; the button stays above it. */}
                    <Link href={tasksHref(coordinatorId, show, t.purchase_id)} scroll={false} className="font-semibold text-ink after:absolute after:inset-0">
                      {t.client_name ?? t.phone}
                    </Link>
                    {t.client_name && <span className="ml-2 font-mono text-[12px] text-ink-muted">{t.phone}</span>}
                    <p className="m-0 text-[14px] text-ink-soft">
                      {t.test_name} · {t.context}
                    </p>
                    {superAdmin && <p className="m-0 text-[13px] text-ink-muted">Coordinator: {t.coordinator_name ?? 'None yet'}</p>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                    <p className={cn('m-0 text-[14px] sm:text-right', late ? 'font-semibold text-coral-deep' : 'text-ink-soft')}>
                      {late ? 'Late · was due ' : 'Due '}
                      <span className="whitespace-nowrap">{dueLabel(t.due_at, now)}</span>
                    </p>
                    <div className="relative z-10 flex flex-wrap justify-end gap-2">
                      {t.can_book && <BookPresentationButton purchaseId={t.purchase_id} clientLabel={t.client_name ?? t.phone} testName={t.test_name} />}
                      {t.kind === 'payment' && (
                        <OfflinePaymentDialog purchase={{ id: t.purchase_id, testCode: t.test_code, testName: t.test_name }} staffName={profile.full_name} />
                      )}
                      {t.kind === 'package' && <PackagePaymentDialog purchaseId={t.purchase_id} clientLabel={t.client_name ?? t.phone} />}
                      <CallDoneButton callId={t.call_id} kind={t.kind} priorCalls={t.prior_calls} adminOnlyNotInterested={t.package_part_paid && !superAdmin} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {open && <PurchasePanel purchase={open} closeHref={tasksHref(coordinatorId, show)} now={now} canCancelBooking={superAdmin} />}
    </AdminShell>
  );
}

// Super admins: presentations whose slot time has passed but nobody marked done, oldest first. Marking one done
// here creates its Package call (as from My presentations).
function UnmarkedList({ rows }: { rows: PresentationRow[] }) {
  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center sm:p-12">
        <PhoneCall size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
        <p className="text-[16px] font-medium text-ink">{EMPTY.unmarked}</p>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-sand">
        {rows.map((r) => {
          const client = r.client_name ?? r.phone;
          return (
            <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-coral-deep">Presentation not marked done</p>
                <Link href={`/purchases?tab=paid&open=${r.purchase_id}`} className="font-semibold text-ink hover:underline">
                  {client}
                </Link>
                <p className="m-0 text-[14px] text-ink-soft">
                  {r.test_name} · {r.counsellor_name ?? 'Counsellor'} · {presentationLabel(r.on_date, r.start_time, r.end_time)}
                </p>
                <p className="m-0 text-[13px] text-ink-muted">Coordinator: {r.coordinator_name ?? 'None yet'}</p>
              </div>
              <PresentationDoneButton bookingId={r.id} summary={`${client} · ${presentationLabel(r.on_date, r.start_time, r.end_time)}`} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
