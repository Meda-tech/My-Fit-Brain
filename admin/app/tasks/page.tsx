import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PhoneCall } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, cn } from '../../components/brand';
import { PurchasePanel } from '../../components/purchases/PurchasePanel';
import { CallDoneButton } from '../../components/calls/CallDoneButton';
import { TaskFilters } from '../../components/calls/TaskFilters';
import { formatDateTime, formatTime } from '../../components/payments/format';
import { CALL_KIND_LABELS, TASK_SECTIONS, TASK_SECTION_LABELS, isCallLate, taskSection, type TaskSection } from '../../lib/calls';
import { canViewPurchases, getPurchase, syncCalls } from '../../lib/services/purchases';
import { listCoordinators, listTasks, type TaskRow } from '../../lib/services/calls';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// My tasks: the open Payment and Assessment calls, in Overdue · Today · Upcoming. A coordinator sees the calls of
// their own clients; super admins see all, with a coordinator filter. "Late only" for both. A row opens the same
// right-side panel as Purchases; its button opens Mark as call done.
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ coordinator?: string; late?: string; open?: string }>;
}) {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) redirect('/dashboard');
  const sp = await searchParams;
  const superAdmin = profile.role === 'super_admin';
  const coordinatorId = superAdmin && sp.coordinator && UUID.test(sp.coordinator) ? sp.coordinator : '';
  const lateOnly = sp.late === '1';

  await syncCalls();
  const [tasks, coordinators, open] = await Promise.all([
    listTasks({ coordinatorId, lateOnly }),
    superAdmin ? listCoordinators() : Promise.resolve(null),
    sp.open && UUID.test(sp.open) ? getPurchase(sp.open) : Promise.resolve(null),
  ]);

  const now = new Date();
  const listQuery = new URLSearchParams();
  if (coordinatorId) listQuery.set('coordinator', coordinatorId);
  if (lateOnly) listQuery.set('late', '1');
  const listHref = listQuery.size ? `/tasks?${listQuery}` : '/tasks';
  const openHref = (purchaseId: string) => {
    const q = new URLSearchParams(listQuery);
    q.set('open', purchaseId);
    return `/tasks?${q}`;
  };

  const sections = TASK_SECTIONS.map((s) => ({ key: s, rows: tasks.filter((t) => taskSection(t.due_at, now) === s) })).filter(
    (s) => s.rows.length > 0
  );

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="My tasks"
        description={superAdmin ? 'Every open call, soonest first.' : 'The calls to make for your clients, soonest first.'}
      />

      <TaskFilters coordinators={coordinators} coordinatorId={coordinatorId} lateOnly={lateOnly} />

      {sections.length === 0 ? (
        <Card className="p-10 text-center sm:p-12">
          <PhoneCall size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
          <p className="text-[16px] font-medium text-ink">{lateOnly ? 'No late calls.' : 'No calls to make right now.'}</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {sections.map((s) => (
            <TaskSectionCard key={s.key} section={s.key} rows={s.rows} now={now} openHref={openHref} openId={open?.id} showCoordinator={superAdmin} />
          ))}
        </div>
      )}

      {open && <PurchasePanel purchase={open} closeHref={listHref} now={now} />}
    </AdminShell>
  );
}

function TaskSectionCard({
  section,
  rows,
  now,
  openHref,
  openId,
  showCoordinator,
}: {
  section: TaskSection;
  rows: TaskRow[];
  now: Date;
  openHref: (purchaseId: string) => string;
  openId: string | undefined;
  showCoordinator: boolean;
}) {
  return (
    <section aria-labelledby={`tasks-${section}`}>
      <h2 id={`tasks-${section}`} className={cn('mb-2 text-[18px] font-semibold', section === 'overdue' ? 'text-coral-deep' : 'text-teal')}>
        {TASK_SECTION_LABELS[section]} <span className="text-[14px] font-medium text-ink-muted">({rows.length})</span>
      </h2>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-sand">
          {rows.map((t) => {
            const late = isCallLate(t.due_at, now);
            return (
              <li
                key={t.call_id}
                className={cn('relative flex flex-col gap-3 p-4 hover:bg-cream sm:flex-row sm:items-center sm:gap-4 sm:px-5', openId === t.purchase_id && 'bg-mist')}
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-teal">{CALL_KIND_LABELS[t.kind]}</p>
                  {/* The link covers the whole row; the button stays above it. */}
                  <Link href={openHref(t.purchase_id)} scroll={false} className="font-semibold text-ink after:absolute after:inset-0">
                    {t.client_name ?? t.phone}
                  </Link>
                  {t.client_name && <span className="ml-2 font-mono text-[12px] text-ink-muted">{t.phone}</span>}
                  <p className="m-0 text-[14px] text-ink-soft">
                    {t.test_name} · {t.context}
                  </p>
                  {showCoordinator && <p className="m-0 text-[13px] text-ink-muted">Coordinator: {t.coordinator_name ?? 'None yet'}</p>}
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <p className={cn('m-0 text-[14px] sm:text-right', late ? 'font-semibold text-coral-deep' : 'text-ink-soft')}>
                    {late ? 'Late · ' : 'Due '}
                    {section === 'today' ? formatTime(t.due_at) : formatDateTime(t.due_at)}
                  </p>
                  <CallDoneButton callId={t.call_id} kind={t.kind} priorCalls={t.prior_calls} className="relative z-10" />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
