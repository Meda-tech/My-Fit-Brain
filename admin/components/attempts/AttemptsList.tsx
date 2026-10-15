import Link from 'next/link';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { Card } from '../brand';
import type { AttemptListRow } from '../../lib/services/attempts';
import { AttemptStatusPill, formatDateTime } from './AttemptStatusPill';

/** Assessments of one client, newest first. */
export function AttemptsList({ attempts }: { attempts: AttemptListRow[] }) {
  return (
    <Card className="@container mt-6 overflow-hidden">
      <div className="border-b border-sand p-5">
        <h2 className="flex items-center gap-2 text-[20px] font-semibold text-teal">
          <ClipboardList size={18} strokeWidth={2} aria-hidden />
          <span>Assessments</span>
        </h2>
      </div>
      {attempts.length === 0 ? (
        <p className="p-5 text-[15px] text-ink-muted">No assessments yet.</p>
      ) : (
        <ul className="divide-y divide-sand">
          {attempts.map((a) => (
            <li key={a.id}>
              <Link href={`/attempts/${a.id}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-mist/50 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[14px] font-semibold text-ink">{a.report_id}</p>
                  <p className="mt-0.5 text-[14px] text-ink-soft">
                    {a.test_name} · version {a.version_label}
                    {a.kind === 'progress' ? ' · progress' : ''}
                    {a.payment_mode === 'stub' ? ' · test payment' : ''}
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-muted">
                    Paid {formatDateTime(a.paid_at)}
                    {a.completed_at ? ` · completed ${formatDateTime(a.completed_at)}` : ''}
                  </p>
                </div>
                <AttemptStatusPill status={a.status} />
                <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
