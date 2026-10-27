import { Card } from '../brand';
import type { DetailAnswer } from '../../lib/services/attempts';
import { formatDateTime } from './AttemptStatusPill';

// The client's typed answers to the client-details questions, each with the question as it was asked.
// Counsellors and super admins only. Never printed in the PDF.

export function ClientDetailsAnswers({ details }: { details: DetailAnswer[] }) {
  if (details.length === 0) return null;
  return (
    <Card className="mt-6 p-5 sm:p-6">
      <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Client details (typed by the client)</h3>
      <p className="mb-4 text-[13px] text-ink-muted">For the care team only. Not part of the report or the PDF.</p>
      <dl className="divide-y divide-sand">
        {details.map((d) => (
          <div key={d.detail_id} className="py-4 first:pt-0 last:pb-0">
            <dt className="text-[14px] font-medium text-ink-soft">
              {d.question.en}
              {d.question.hi && (
                <span lang="hi" className="block text-ink-muted">
                  {d.question.hi}
                </span>
              )}
            </dt>
            <dd className="mt-1.5 whitespace-pre-wrap break-words text-[16px] leading-6.5 text-ink">{d.answer}</dd>
            <dd className="mt-1 text-[12px] text-ink-muted">Answered {formatDateTime(d.answered_at)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
