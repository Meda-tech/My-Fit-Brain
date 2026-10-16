'use client';

import { useState } from 'react';
import { cn } from '../brand';

export type AttemptView = 'report' | 'counsellor';

// Report | Counsellor view. Both panels are rendered on the server once; switching only toggles which
// one is shown, so it is instant. The choice is kept in the URL (?view=) for links and reloads.
export function AttemptTabs({
  initial,
  report,
  counsellor,
  alerts,
}: {
  initial: AttemptView;
  report: React.ReactNode;
  counsellor: React.ReactNode;
  /** Safety events count, shown on the Counsellor view tab. */
  alerts: number;
}) {
  const [view, setView] = useState<AttemptView>(initial);
  const tabs: { id: AttemptView; label: string }[] = [
    { id: 'report', label: 'Report' },
    { id: 'counsellor', label: 'Counsellor view' },
  ];

  const select = (id: AttemptView) => {
    setView(id);
    const url = new URL(window.location.href);
    if (id === 'report') url.searchParams.delete('view');
    else url.searchParams.set('view', id);
    window.history.replaceState(null, '', url);
  };

  return (
    <div>
      <div role="tablist" aria-label="Assessment sections" className="mb-6 flex gap-1 border-b border-sand print:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={view === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => select(t.id)}
            className={cn(
              'inline-flex min-h-11 items-center border-b-2 px-4 text-[15px] font-medium transition-colors',
              view === t.id ? 'border-teal font-semibold text-teal' : 'border-transparent text-ink-soft hover:text-teal'
            )}
          >
            {t.label}
            {t.id === 'counsellor' && alerts > 0 && (
              <span
                className="ml-1.5 rounded-full bg-coral-deep px-1.5 text-[11px] font-semibold leading-4.5 text-white"
                aria-label={`${alerts} safety ${alerts === 1 ? 'event' : 'events'}`}
              >
                {alerts}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-report" aria-labelledby="tab-report" hidden={view !== 'report'} className="print:block!">
        {report}
      </div>
      <div role="tabpanel" id="panel-counsellor" aria-labelledby="tab-counsellor" hidden={view !== 'counsellor'} className="print:hidden">
        {counsellor}
      </div>
    </div>
  );
}
