import type { ReactNode } from 'react';
import type { Lang, ReportArea, ReportDocument, ReportSection } from './types';

// The web report, identical in the clients app and the admin. Sections follow the developer spec
// (section 7). With both languages, each section shows English then Hindi. Counsellor-only data is
// never part of the stored report, so it cannot appear here.

export interface ReportViewProps {
  doc: ReportDocument;
  /** Endorsed logo for the header (each app renders its own copy of the brand file). */
  logo: ReactNode;
  /** Founder seal for the footer. */
  seal: ReactNode;
  /** UI words for the meta line, per language. */
  labels: Record<Lang, { reportId: string; date: string }>;
}

// Static class names so Tailwind generates them (band tokens are proposed, calm, never red).
const BAND_BAR: Record<string, string> = {
  Low: 'bg-band-low',
  Mild: 'bg-band-mild',
  Moderate: 'bg-band-moderate',
  High: 'bg-band-high',
};
const BAND_PILL: Record<string, string> = {
  Low: 'bg-band-low text-band-low-text',
  Mild: 'bg-band-mild text-band-mild-text',
  Moderate: 'bg-band-moderate text-band-moderate-text',
  High: 'bg-band-high text-band-high-text',
};

function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function ReportView({ doc, logo, seal, labels }: ReportViewProps) {
  const langs = doc.languages.filter((l) => doc.sections[l]);
  const each = (render: (s: ReportSection, lang: Lang) => ReactNode) =>
    langs.map((lang) => (
      <div key={lang} lang={lang} className={langs.length > 1 && lang === 'hi' ? 'mt-4 border-t border-sand pt-4' : undefined}>
        {render(doc.sections[lang] as ReportSection, lang)}
      </div>
    ));
  const any = (pick: (s: ReportSection) => unknown) => langs.some((l) => {
    const v = pick(doc.sections[l] as ReportSection);
    return Array.isArray(v) ? v.length > 0 : !!v;
  });

  return (
    <article className="mx-auto w-full max-w-[760px] text-ink">
      {/* Crisis block first (crisis layout only) */}
      {doc.layout === 'crisis' && any((s) => s.crisis) && (
        <section className="mb-6 rounded-card border border-sand border-l-4 border-l-teal bg-mist p-5 sm:p-6">
          {each((s) => s.crisis && <p className="text-[17px] leading-[27px] text-ink">{s.crisis}</p>)}
        </section>
      )}

      <section className="rounded-card border border-sand bg-white p-5 shadow-card sm:p-8">
        {/* Header */}
        <header className="mb-8 border-b border-sand pb-6">
          <div className="mb-5">{logo}</div>
          {each((s, lang) => (
            <>
              {s.title && <h1 className="text-[26px] font-semibold leading-[1.25] text-teal sm:text-[30px]">{s.title}</h1>}
              {s.subtitle && <p className="mt-2 text-[16px] text-ink-soft">{s.subtitle}</p>}
              {s.designedBy && <p className="mt-1 text-[14px] text-ink-muted">{s.designedBy}</p>}
              <p className="mt-3 text-[13px] text-ink-muted">
                {doc.reportId && (
                  <>
                    {labels[lang].reportId}: <span className="font-mono">{doc.reportId}</span> ·{' '}
                  </>
                )}
                {labels[lang].date}: {formatDate(doc.completedAt, lang)}
              </p>
            </>
          ))}
        </header>

        {/* Snapshot */}
        <Block>
          {each((s) => (
            <>
              <Heading>{s.snapshot.heading}</Heading>
              <ul className="space-y-4">
                {s.snapshot.areas.map((a) => (
                  <AreaBar key={a.module} area={a} />
                ))}
              </ul>
              {s.snapshot.note && <p className="mt-3 text-[13px] text-ink-muted">{s.snapshot.note}</p>}
            </>
          ))}
        </Block>

        {any((s) => s.strengths.items) && (
          <Block>
            {each((s) => (
              <>
                <Heading>{s.strengths.heading}</Heading>
                <List items={s.strengths.items} />
              </>
            ))}
          </Block>
        )}

        {any((s) => s.stuck.items) && (
          <Block>
            {each((s) => (
              <>
                <Heading>{s.stuck.heading}</Heading>
                <List items={s.stuck.items} />
              </>
            ))}
          </Block>
        )}

        {any((s) => s.means.items) && (
          <Block>
            {each((s) => (
              <>
                <Heading>{s.means.heading}</Heading>
                {s.means.items.map((t, i) => (
                  <p key={i} className="mb-3 text-[16px] leading-[26px] text-ink-soft last:mb-0">
                    {t}
                  </p>
                ))}
              </>
            ))}
          </Block>
        )}

        {any((s) => s.plan) && (
          <Block>
            {each((s) =>
              s.plan ? (
                <>
                  <Heading>{s.plan.heading}</Heading>
                  {s.plan.line && <p className="rounded-input bg-mist p-4 text-[16px] leading-[26px] text-ink">{s.plan.line}</p>}
                  {s.plan.extra.map((t, i) => (
                    <p key={i} className="mt-3 text-[15px] leading-[24px] text-ink-soft">
                      {t}
                    </p>
                  ))}
                </>
              ) : null
            )}
          </Block>
        )}

        {any((s) => s.focus?.items) && (
          <Block>
            {each((s) =>
              s.focus ? (
                <>
                  <Heading>{s.focus.heading}</Heading>
                  <List items={s.focus.items} />
                </>
              ) : null
            )}
          </Block>
        )}

        {any((s) => s.blocks) && (
          <Block>
            {each((s) => (
              <>
                {s.blocks.map((b, i) => {
                  const firstMedical = b.kind === 'medical' && s.blocks.findIndex((x) => x.kind === 'medical') === i;
                  return (
                    <div key={i} className="mb-4 last:mb-0">
                      {firstMedical && s.medicalHeading && <Heading>{s.medicalHeading}</Heading>}
                      <p className="rounded-input border border-sand border-l-4 border-l-teal bg-cream p-4 text-[15px] leading-[24px] text-ink-soft">
                        {b.text}
                      </p>
                    </div>
                  );
                })}
              </>
            ))}
          </Block>
        )}

        <Block>
          {each((s) => (
            <>
              <Heading>{s.next.heading}</Heading>
              {s.next.text && <p className="text-[16px] leading-[26px] text-ink-soft">{s.next.text}</p>}
            </>
          ))}
        </Block>

        {any((s) => s.nri) && (
          <Block>{each((s) => s.nri && <p className="text-[15px] leading-[24px] text-ink-soft">{s.nri}</p>)}</Block>
        )}

        {any((s) => s.disclaimer) && (
          <div className="mt-8 border-t border-sand pt-6">
            {each((s) => s.disclaimer && <p className="text-[13px] leading-[21px] text-ink-muted">{s.disclaimer}</p>)}
          </div>
        )}

        <footer className="mt-8 flex justify-center">{seal}</footer>
      </section>
    </article>
  );
}

function Block({ children }: { children: ReactNode }) {
  return <section className="mb-8 last:mb-0">{children}</section>;
}

function Heading({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <h2 className="mb-3 text-[20px] font-semibold leading-[1.3] text-teal sm:text-[22px]">{children}</h2>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3 text-[16px] leading-[26px] text-ink-soft">
          <span aria-hidden className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function AreaBar({ area }: { area: ReportArea }) {
  const pct = Math.max(0, Math.min(100, area.percent ?? 0));
  return (
    <li>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] font-medium text-ink">{area.name ?? area.module}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[14px] tabular-nums text-ink-soft">{area.percent ?? '—'}%</span>
          {area.bandName && (
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${BAND_PILL[area.band ?? ''] ?? 'bg-mist text-teal'}`}>
              {area.bandName}
            </span>
          )}
        </span>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-sand"
        role="img"
        aria-label={`${area.name ?? area.module}: ${area.percent ?? 0}%${area.bandName ? `, ${area.bandName}` : ''}`}
      >
        <div className={`h-full rounded-full ${BAND_BAR[area.band ?? ''] ?? 'bg-teal'}`} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}
