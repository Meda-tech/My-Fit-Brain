import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, cn } from '../../components/brand';
import { SidePanel } from '../../components/purchases/SidePanel';
import { CounsellorPicker } from '../../components/availability/CounsellorPicker';
import { DayActions, UndoButton } from '../../components/availability/DayActions';
import { formatDateTime } from '../../components/payments/format';
import {
  SLOT_STATE_LABELS,
  WEEKDAY_SHORT,
  addMonths,
  countByDay,
  dayLabel,
  describeChange,
  describeSettings,
  hm,
  isDate,
  isMonth,
  istToday,
  monthGrid,
  monthLabel,
  monthRange,
  type AvailabilityChange,
  type DayCounts,
  type Slot,
} from '../../lib/availability';
import {
  canManageAvailability,
  counsellorSlots,
  dayChanges,
  getAvailabilitySettings,
  listCounsellors,
} from '../../lib/services/availability';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATE_CLASSES: Record<Slot['state'], string> = {
  free: 'border-teal/30 bg-white text-teal',
  booked: 'border-teal bg-teal text-white',
  off: 'border-sand bg-cream text-ink-muted',
};

// Counsellor availability (step 3, super admins only). Pick a counsellor → month view with free / booked / off per
// date → a date opens a right-side panel with that day's slots, Mark off, Add custom slots, Undo and the history.
// Counsellors and coordinators cannot open this page.
export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ c?: string; m?: string; d?: string }> }) {
  const { profile } = await requireStaff();
  if (!canManageAvailability(profile.role)) redirect('/dashboard');
  const sp = await searchParams;

  const today = istToday();
  const [counsellors, settings] = await Promise.all([listCounsellors(), getAvailabilitySettings()]);
  const counsellor = counsellors.find((c) => sp.c && UUID.test(sp.c) && c.id === sp.c) ?? counsellors[0] ?? null;
  const month = isMonth(sp.m) ? sp.m : today.slice(0, 7);
  const day = isDate(sp.d) ? sp.d : null;
  const href = (q: { m?: string; d?: string }) =>
    `/availability?${new URLSearchParams({ ...(counsellor ? { c: counsellor.id } : {}), m: q.m ?? month, ...(q.d ? { d: q.d } : {}) })}`;

  const { from, to } = monthRange(month);
  const [slots, daySlots, changes] = counsellor
    ? await Promise.all([
        counsellorSlots(counsellor.id, from, to),
        day ? counsellorSlots(counsellor.id, day, day) : Promise.resolve([] as Slot[]),
        day ? dayChanges(counsellor.id, day) : Promise.resolve([] as AvailabilityChange[]),
      ])
    : [[], [], []];
  const counts = countByDay(slots);

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Counsellor availability"
        description={settings ? `Default for every counsellor: ${describeSettings(settings)}. Sunday off unless slots are added.` : undefined}
      />

      {!counsellor ? (
        <Card className="p-10 text-center sm:p-12">
          <CalendarClock size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
          <p className="text-[16px] font-medium text-ink">No active counsellors.</p>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CounsellorPicker counsellors={counsellors} counsellorId={counsellor.id} month={month} />
            <nav aria-label="Month" className="flex items-center justify-between gap-2 sm:justify-end">
              <Link href={href({ m: addMonths(month, -1) })} aria-label="Previous month" className="flex h-11 w-11 items-center justify-center rounded-full text-teal hover:bg-mist">
                <ChevronLeft size={20} strokeWidth={2} aria-hidden />
              </Link>
              <span className="min-w-36 text-center text-[16px] font-semibold text-teal">{monthLabel(month)}</span>
              <Link href={href({ m: addMonths(month, 1) })} aria-label="Next month" className="flex h-11 w-11 items-center justify-center rounded-full text-teal hover:bg-mist">
                <ChevronRight size={20} strokeWidth={2} aria-hidden />
              </Link>
            </nav>
          </div>

          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-sand bg-cream text-center text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              {WEEKDAY_SHORT.map((w) => (
                <div key={w} className="py-2">
                  <span className="sm:hidden">{w.slice(0, 1)}</span>
                  <span className="hidden sm:inline">{w}</span>
                </div>
              ))}
            </div>
            <div className="divide-y divide-sand">
              {monthGrid(month).map((week, i) => (
                <div key={i} className="grid grid-cols-7 divide-x divide-sand">
                  {week.map((date, j) =>
                    date ? (
                      <DayCell key={date} date={date} counts={counts.get(date)} past={date < today} today={date === today} selected={date === day} href={href({ d: date })} />
                    ) : (
                      <div key={`blank-${j}`} className="bg-cream/60" />
                    )
                  )}
                </div>
              ))}
            </div>
          </Card>
          <p className="mt-3 text-[13px] text-ink-muted">Each date: free slots, then booked and off when there are any. Pick a date to see its slots and make changes.</p>
        </>
      )}

      {counsellor && day && (
        <SidePanel title={dayLabel(day)} closeHref={href({})}>
          <DayPanel counsellorName={counsellor.full_name} counsellorId={counsellor.id} day={day} past={day < today} slots={daySlots} changes={changes} slotMinutes={settings?.slot_minutes ?? 30} />
        </SidePanel>
      )}
    </AdminShell>
  );
}

function DayCell({ date, counts, past, today, selected, href }: { date: string; counts: DayCounts | undefined; past: boolean; today: boolean; selected: boolean; href: string }) {
  const c = counts ?? { free: 0, booked: 0, off: 0 };
  const none = c.free + c.booked + c.off === 0;
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={`${dayLabel(date)}: ${c.free} free, ${c.booked} booked, ${c.off} off`}
      className={cn(
        'flex min-h-16 flex-col gap-0.5 p-1.5 text-[12px] leading-4 hover:bg-mist sm:min-h-24 sm:p-2 sm:text-[13px]',
        past && 'bg-cream/60 text-ink-muted',
        selected && 'bg-mist'
      )}
    >
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold',
          today ? 'bg-teal text-white' : past ? 'text-ink-muted' : 'text-ink'
        )}
      >
        {Number(date.slice(8))}
      </span>
      {none ? (
        <span className="text-ink-muted">
          <span className="sm:hidden">–</span>
          <span className="hidden sm:inline">No slots</span>
        </span>
      ) : (
        <>
          <span className={cn('font-semibold', c.free ? 'text-teal' : 'text-ink-muted')}>
            {c.free}
            <span className="hidden sm:inline"> free</span>
          </span>
          {c.booked > 0 && (
            <span className="text-ink">
              {c.booked}
              <span className="hidden sm:inline"> booked</span>
              <span className="sm:hidden"> b</span>
            </span>
          )}
          {c.off > 0 && (
            <span className="text-ink-muted">
              {c.off}
              <span className="hidden sm:inline"> off</span>
              <span className="sm:hidden"> off</span>
            </span>
          )}
        </>
      )}
    </Link>
  );
}

function DayPanel({
  counsellorName,
  counsellorId,
  day,
  past,
  slots,
  changes,
  slotMinutes,
}: {
  counsellorName: string;
  counsellorId: string;
  day: string;
  past: boolean;
  slots: Slot[];
  changes: AvailabilityChange[];
  slotMinutes: number;
}) {
  const counts = countByDay(slots).get(day) ?? { free: 0, booked: 0, off: 0 };
  const active = changes.filter((c) => !c.removed_at);
  return (
    <div className="grid gap-6">
      <div>
        <p className="m-0 font-medium text-ink">{counsellorName}</p>
        <p className="m-0 text-[14px] text-ink-soft">
          {counts.free} free · {counts.booked} booked · {counts.off} off
        </p>
      </div>

      {past ? (
        <p className="m-0 text-[14px] text-ink-muted">This date has passed. It can no longer be changed.</p>
      ) : (
        <DayActions counsellorId={counsellorId} date={day} slotMinutes={slotMinutes} />
      )}

      <section>
        <h3 className="mb-2 text-[16px] font-semibold text-teal">Slots ({slots.length})</h3>
        {slots.length === 0 ? (
          <p className="m-0 text-[14px] text-ink-muted">No slots on this date.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots.map((s) => (
              <li key={s.start_time} className={cn('rounded-input border px-2.5 py-2 text-[14px]', STATE_CLASSES[s.state])}>
                <span className="block font-semibold">
                  {hm(s.start_time)}–{hm(s.end_time)}
                </span>
                <span className="text-[12px]">
                  {SLOT_STATE_LABELS[s.state]}
                  {s.custom_change ? ' · custom' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active.length > 0 && (
        <section>
          <h3 className="mb-2 text-[16px] font-semibold text-teal">Changes on this date</h3>
          <ul className="grid gap-2">
            {active.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 rounded-card border border-sand p-3">
                <div className="min-w-0">
                  <p className="m-0 font-medium text-ink">{describeChange(c)}</p>
                  {c.reason && <p className="m-0 text-[14px] text-ink-soft">{c.reason}</p>}
                  <p className="m-0 text-[12px] text-ink-muted">
                    By {c.created_by_name ?? '—'}, {formatDateTime(c.created_at)}
                  </p>
                </div>
                {!past && <UndoButton changeId={c.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {changes.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-teal">
            <span className="transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
            History ({changes.length})
          </summary>
          <ol className="mt-2 grid gap-2">
            {[...changes].reverse().map((c) => (
              <li key={c.id} className="rounded-card border border-sand p-3 text-[14px]">
                <p className="m-0 font-medium text-ink">
                  {describeChange(c)}
                  {c.reason ? ` · ${c.reason}` : ''}
                </p>
                <p className="m-0 text-[12px] text-ink-muted">
                  Added by {c.created_by_name ?? '—'}, {formatDateTime(c.created_at)}
                </p>
                {c.removed_at && (
                  <p className="m-0 text-[12px] text-ink-muted">
                    Undone by {c.removed_by_name ?? '—'}, {formatDateTime(c.removed_at)}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
