import { Check, Minus, X } from 'lucide-react';
import { cn } from '../brand';
import { formatDateTime } from '../payments/format';
import { JOURNEY_STATUS_LABELS, type JourneyItem, type JourneyStatus, type JourneyTask, type JourneyTaskKey } from '../../lib/journey';

// The purchase journey as our team's five tasks, with call attempts and the client's steps nested under each
// (lib/journey.ts builds it). Status: done ✓ · open ● · upcoming ○ · not interested ✕ · not needed (strikethrough).
// Calm colours: teal for done and open, quiet for the rest; coral-deep only for "late".

function StatusIcon({ status }: { status: JourneyStatus }) {
  const base = 'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full';
  switch (status) {
    case 'done':
      return (
        <span className={cn(base, 'bg-teal text-white')}>
          <Check size={15} strokeWidth={3} aria-hidden />
        </span>
      );
    case 'open':
      return (
        <span className={cn(base, 'border-2 border-teal bg-white')}>
          <span className="h-2.5 w-2.5 rounded-full bg-teal" />
        </span>
      );
    case 'not_interested':
      return (
        <span className={cn(base, 'border border-ink-muted bg-white text-ink-muted')}>
          <X size={14} strokeWidth={2.5} aria-hidden />
        </span>
      );
    case 'not_needed':
      return (
        <span className={cn(base, 'border border-sand bg-cream text-ink-muted')}>
          <Minus size={14} strokeWidth={2.5} aria-hidden />
        </span>
      );
    default:
      return <span className={cn(base, 'border-2 border-sand bg-white')} />;
  }
}

function Item({ item }: { item: JourneyItem }) {
  return (
    <li className="relative pl-4 text-[14px] before:absolute before:top-2 before:left-0 before:h-1.5 before:w-1.5 before:rounded-full before:bg-sand">
      <p className="m-0 text-[12px] text-ink-muted">
        {formatDateTime(item.at)}
        {item.by ? ` · ${item.by}` : ''}
      </p>
      <p className={cn('m-0', item.kind === 'call' ? 'font-medium text-ink' : item.kind === 'client' ? 'font-medium text-teal' : 'text-ink-soft')}>
        {item.title}
      </p>
      {item.detail && <p className="m-0 text-ink-soft">{item.detail}</p>}
      {item.followUp && <p className="m-0 text-ink-soft">Follow-up: {formatDateTime(item.followUp)}</p>}
      {item.note && <p className="m-0 mt-0.5 whitespace-pre-line rounded-input bg-cream px-2.5 py-1.5 text-ink-soft">{item.note}</p>}
    </li>
  );
}

function Times({ t }: { t: JourneyTask }) {
  if (t.status === 'not_needed' && t.notNeeded) {
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        Not needed – {t.notNeeded.what}
        {t.notNeeded.at ? ` at ${formatDateTime(t.notNeeded.at)}` : ''}
      </p>
    );
  }
  if (!t.planned && !t.actual) return null;
  return (
    <p className="m-0 text-[13px] text-ink-soft">
      {t.planned && (
        <span className={cn(t.late && 'font-semibold text-coral-deep')}>
          {t.late ? 'Late · was due ' : 'Planned '}
          {formatDateTime(t.planned)}
        </span>
      )}
      {t.planned && t.actual && <span className="text-ink-muted"> · </span>}
      {t.actual && (
        <span className={cn(t.actualLate && 'font-semibold text-coral-deep')}>
          Actual {formatDateTime(t.actual)}
          {t.actualLate ? ' (late)' : ''}
        </span>
      )}
    </p>
  );
}

export function JourneyView({ tasks, actions }: { tasks: JourneyTask[]; actions: Partial<Record<JourneyTaskKey, React.ReactNode>> }) {
  return (
    <section aria-labelledby="journey-title" className="mb-6">
      <h3 id="journey-title" className="mb-3 text-[16px] font-semibold text-teal">
        Purchase journey
      </h3>
      <ol className="m-0 grid list-none gap-0 p-0">
        {tasks.map((t, i) => {
          const upcoming = t.status === 'upcoming';
          const action = actions[t.key];
          return (
            <li key={t.key} className="relative flex gap-3 pb-5 last:pb-0">
              {/* The line joining the steps. */}
              {i < tasks.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-3.5 w-px bg-sand" />}
              <StatusIcon status={t.status} />
              <div className={cn('min-w-0 flex-1', upcoming && 'opacity-55')}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className={cn('m-0 font-semibold text-ink', t.status === 'not_needed' && 'text-ink-muted line-through')}>
                    {i + 1}. {t.title}
                  </p>
                  <span className={cn('text-[12px] font-semibold', t.status === 'open' ? 'text-teal' : 'text-ink-muted')}>
                    {JOURNEY_STATUS_LABELS[t.status]}
                  </span>
                </div>
                <p className="m-0 text-[13px] text-ink-muted">
                  {t.whoRole}: {t.who ?? '—'}
                </p>
                <Times t={t} />
                {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
                {t.items.length > 0 && (
                  <details className="group mt-1.5" open={t.status === 'open'}>
                    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-teal">
                      <span className="transition-transform group-open:rotate-90" aria-hidden>
                        ›
                      </span>
                      {t.items.length} {t.items.length === 1 ? 'entry' : 'entries'}
                    </summary>
                    <ul className="m-0 mt-1 grid list-none gap-2.5 border-l border-sand py-1 pl-3">
                      {t.items.map((item, j) => (
                        <Item key={`${item.at}-${j}`} item={item} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
