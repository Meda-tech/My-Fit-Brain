import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserX } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, Pill } from '../../components/brand';
import { formatDate, formatTime } from '../../components/payments/format';
import { canViewPayments, listAgeStops, type AgeStopRow } from '../../lib/services/payments';

export const dynamic = 'force-dynamic';

function RefundState({ row }: { row: AgeStopRow }) {
  if (row.paidCount === 0) return <span className="text-ink-muted">No payment</span>;
  if (row.refundNeededCount > 0) {
    return (
      <Link href={`/payments?status=refund_needed&q=${encodeURIComponent(row.phone)}`} className="font-semibold text-coral-deep hover:underline">
        Refund needed ({row.refundNeededCount})
      </Link>
    );
  }
  if (row.refundedCount === row.paidCount) return <Pill>Refunded</Pill>;
  return (
    <Link href={`/payments?q=${encodeURIComponent(row.phone)}`} className="text-teal hover:underline">
      {row.paidCount} paid
    </Link>
  );
}

// Under-18 stops at registration (super admins and coordinators; RLS can_view_payments()). Minimal record
// only: number, name typed, age entered, when. No account exists for these people.
export default async function UnderEighteenPage() {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) redirect('/dashboard');
  const rows = await listAgeStops();

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Under 18"
        description="People who entered an age under 18 at registration. They were stopped and no account was created. Only the number, the name typed, the age entered and the time are kept, so any payment can be refunded."
      />

      <Card className="overflow-hidden">
        <div className="border-b border-sand p-4 sm:p-5">
          <p className="text-[16px] font-semibold text-teal">
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <UserX size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">Nobody has been stopped yet.</p>
            <p className="mt-1 text-[14px] text-ink-muted">Someone appears here when they enter an age under 18 at registration.</p>
          </div>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-sand md:hidden">
              {rows.map((r) => (
                <li key={r.phone} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{r.full_name || 'No name'}</p>
                      <p className="font-mono text-[12px] text-ink-muted">{r.phone}</p>
                    </div>
                    <p className="shrink-0 text-[14px] text-ink">{r.age} years</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-ink-muted">
                      {formatDate(r.last_at)}, {formatTime(r.last_at)}
                    </span>
                    <RefundState row={r} />
                  </div>
                </li>
              ))}
            </ul>

            {/* Wider screens: table */}
            <table className="hidden w-full text-left text-[14px] md:table">
              <thead className="border-b border-sand bg-cream text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Stopped</th>
                  <th className="px-5 py-3">Name (typed)</th>
                  <th className="px-5 py-3">Mobile</th>
                  <th className="px-5 py-3">Age entered</th>
                  <th className="px-5 py-3">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand">
                {rows.map((r) => (
                  <tr key={r.phone}>
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <p className="text-ink">{formatDate(r.last_at)}</p>
                      <p className="text-[12px] text-ink-muted">{formatTime(r.last_at)}</p>
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-ink">{r.full_name || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-[13px] text-ink-soft">{r.phone}</td>
                    <td className="px-5 py-3.5 text-ink">{r.age} years</td>
                    <td className="px-5 py-3.5">
                      <RefundState row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </AdminShell>
  );
}
