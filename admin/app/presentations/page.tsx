import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Presentation } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, cn } from '../../components/brand';
import { formatDateTime } from '../../components/payments/format';
import { CounsellorFilter } from '../../components/presentations/CounsellorFilter';
import { PresentationDoneButton } from '../../components/presentations/PresentationDoneButton';
import { presentationLabel } from '../../lib/booking';
import { hm } from '../../lib/availability';
import {
  canViewPresentations,
  listCounsellorsForFilter,
  listPresentations,
  type PresentationRow,
} from '../../lib/services/presentations';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// My presentations (step 5): a counsellor's booked report presentations (super admins: all, with a counsellor
// filter). Upcoming and past. "Report presentation done" from the slot's start (super admins at any time); it
// creates the Package call for the client's coordinator.
export default async function PresentationsPage({ searchParams }: { searchParams: Promise<{ counsellor?: string }> }) {
  const { profile } = await requireStaff();
  if (!canViewPresentations(profile.role)) redirect('/dashboard');
  const sp = await searchParams;
  const superAdmin = profile.role === 'super_admin';
  const counsellorId = superAdmin && sp.counsellor && UUID.test(sp.counsellor) ? sp.counsellor : '';

  const [rows, counsellors] = await Promise.all([listPresentations(counsellorId), superAdmin ? listCounsellorsForFilter() : Promise.resolve([])]);
  const now = new Date().getTime();
  const started = (r: PresentationRow) => new Date(r.starts_at).getTime() <= now;
  const upcoming = rows.filter((r) => !r.done_at && !started(r));
  const past = rows.filter((r) => r.done_at || started(r)).reverse();

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="My presentations"
        description={superAdmin ? 'Every booked report presentation. Pick a counsellor to see theirs.' : 'Your booked report presentations.'}
      />
      {superAdmin && (
        <div className="mb-5">
          <CounsellorFilter counsellors={counsellors} value={counsellorId} base="/presentations" />
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="p-10 text-center sm:p-12">
          <Presentation size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
          <p className="text-[16px] font-medium text-ink">No presentations booked yet.</p>
        </Card>
      ) : (
        <div className="grid gap-6">
          <Section title="Upcoming" rows={upcoming} empty="Nothing upcoming." superAdmin={superAdmin} now={now} />
          <Section title="Past" rows={past} empty="No past presentations." superAdmin={superAdmin} now={now} />
        </div>
      )}
    </AdminShell>
  );
}

function Section({ title, rows, empty, superAdmin, now }: { title: string; rows: PresentationRow[]; empty: string; superAdmin: boolean; now: number }) {
  return (
    <section>
      <h2 className="mb-2 text-[18px] font-semibold text-teal">
        {title} <span className="text-[14px] font-medium text-ink-muted">({rows.length})</span>
      </h2>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="m-0 p-5 text-[14px] text-ink-muted">{empty}</p>
        ) : (
          <ul className="divide-y divide-sand">
            {rows.map((r) => (
              <PresentationItem key={r.id} r={r} superAdmin={superAdmin} now={now} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function PresentationItem({ r, superAdmin, now }: { r: PresentationRow; superAdmin: boolean; now: number }) {
  const started = new Date(r.starts_at).getTime() <= now;
  const client = r.client_name ?? r.phone;
  return (
    <li className="flex flex-col gap-3 p-4 sm:px-5 lg:flex-row lg:items-center lg:gap-6">
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold text-ink">{presentationLabel(r.on_date, r.start_time, r.end_time)}</p>
        <p className="m-0 text-[15px] text-ink">
          {client}
          {r.client_name && <span className="ml-2 font-mono text-[12px] text-ink-muted">{r.phone}</span>}
        </p>
        <p className="m-0 text-[14px] text-ink-soft">
          {r.test_name} · Coordinator: {r.coordinator_name ?? 'None yet'}
          {superAdmin && <> · Counsellor: {r.counsellor_name ?? '—'}</>}
        </p>
        {r.done_at ? (
          <p className="m-0 text-[13px] font-medium text-teal">
            Presentation done {formatDateTime(r.done_at)}
            {r.done_by_name ? ` by ${r.done_by_name}` : ''}
          </p>
        ) : (
          started && <p className="m-0 text-[13px] font-semibold text-coral-deep">Not marked done yet</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {r.attempt_id && (
          <Link
            href={`/attempts/${r.attempt_id}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-teal hover:bg-mist"
          >
            <FileText size={16} strokeWidth={2} aria-hidden />
            Open report
          </Link>
        )}
        {!r.done_at &&
          (started || superAdmin ? (
            <PresentationDoneButton bookingId={r.id} summary={`${client} · ${presentationLabel(r.on_date, r.start_time, r.end_time)}`} variant={started ? 'primary' : 'secondary'} />
          ) : (
            <span className={cn('text-[13px] text-ink-muted')}>Can be marked done from {hm(r.start_time)} on the day</span>
          ))}
      </div>
    </li>
  );
}
