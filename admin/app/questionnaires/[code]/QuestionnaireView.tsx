import { AlertTriangle, ChevronRight, ShieldCheck } from 'lucide-react';
import { describeShowWhen, SAFETY_SECTION, type Definition, type Issue, type Section, type Text } from '@mfb/questionnaire';
import { Card, Notice, Pill } from '../../../components/brand';

// One version of a questionnaire in plain words, split into the two tabs shown on the page: the
// overview (title, warnings, every section collapsed in the order the client sees it, then the built-in
// safety questions) and the report settings. No ids or technical words.

function T({ text, className = '' }: { text: Text; className?: string }) {
  return (
    <span className={className}>
      {text.en}
      {text.hi && (
        <span lang="hi" className="block text-ink-soft">
          {text.hi}
        </span>
      )}
    </span>
  );
}

function Warnings({ warnings }: { warnings: Issue[] }) {
  if (warnings.length === 0) return null;
  return (
    <Notice variant="info" icon={<AlertTriangle size={18} strokeWidth={2} />} title={`${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check (nothing blocks publishing)`}>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px]">
        {warnings.map((w, i) => (
          <li key={i}>
            <span className="font-semibold">{w.where}:</span> {w.message}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** Title, warnings, then every section (collapsed; click to open its questions), then safety. */
export function OverviewView({ definition: def, warnings }: { definition: Definition; warnings: Issue[] }) {
  const questions = def.sections.reduce((n, s) => n + s.questions.length, 0);
  return (
    <div className="space-y-6">
      <Warnings warnings={warnings} />

      <Card className="p-5 sm:p-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Title</p>
        <h2 className="mt-1 text-[22px] font-semibold leading-[1.3] text-teal">
          <T text={def.title} />
        </h2>
        {def.subtitle && (
          <p className="mt-2 text-[15px] text-ink-soft">
            <T text={def.subtitle} />
          </p>
        )}
        <p className="mt-3 text-[13px] text-ink-muted">
          {def.sections.length} sections · {questions} questions, then the two built-in safety questions.
        </p>
      </Card>

      <div>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Sections, in the order the client sees them</h2>
        <Card className="divide-y divide-sand overflow-hidden">
          {def.sections.map((s, si) => (
            <details key={s.id} className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-mist sm:px-5 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-teal transition-transform group-open:rotate-90" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-medium text-ink">
                    {si + 1}. {s.title.en}
                  </span>
                  <span className="block text-[13px] text-ink-muted">
                    {s.questions.length} question{s.questions.length === 1 ? '' : 's'} · {describeShowWhen(def, s.show_when)}
                  </span>
                </span>
                <Pill tone={s.scored ? 'mist' : 'quiet'} className="shrink-0">
                  {s.scored ? 'Scored' : 'Not scored'}
                </Pill>
              </summary>
              <div className="border-t border-sand px-4 pb-5 pt-4 sm:px-5">
                {s.title.hi && (
                  <p lang="hi" className="mb-3 text-[15px] text-ink-soft">
                    {s.title.hi}
                  </p>
                )}
                <SectionQuestions definition={def} section={s} number={si + 1} />
              </div>
            </details>
          ))}
        </Card>
      </div>

      <SafetyView />
    </div>
  );
}

function SectionQuestions({ definition: def, section: s, number }: { definition: Definition; section: Section; number: number }) {
  return (
    <ol className="divide-y divide-sand">
      {s.questions.map((q, qi) => (
        <li key={q.id} className="py-4 first:pt-0 last:pb-0">
          <p className="text-[16px] font-medium text-ink">
            <span className="mr-2 text-ink-muted">
              {number}.{qi + 1}
            </span>
            <T text={q.text} />
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">
            {q.multiple ? (q.max_choices ? `Choose up to ${q.max_choices}` : 'Choose all that apply') : 'Choose one'}
            {q.show_when ? ` · ${describeShowWhen(def, q.show_when)}` : ''}
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {q.options.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 rounded-input bg-cream px-3 py-2 text-[14px]">
                <span className="min-w-0">
                  <T text={o.text} />
                  {o.note && (
                    <span className="mt-1 flex items-start gap-1.5 text-[13px] text-coral-deep">
                      <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
                      <span>Counsellor note: {o.note}</span>
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[12px] text-ink-muted" title="Value: higher = more difficulty">
                  {o.value === null ? 'not counted' : o.value}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** The two questions the engine adds at the end of every questionnaire. */
function SafetyView() {
  return (
    <Card className="border-teal/30 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} strokeWidth={2} className="text-teal" aria-hidden />
        <h2 className="text-[20px] font-semibold text-teal">Built in: safety (always asked last)</h2>
      </div>
      <p className="mt-1 text-[14px] text-ink-muted">The same in every questionnaire and every version. They cannot be changed from the JSON.</p>
      <ol className="mt-4 space-y-3">
        {SAFETY_SECTION.questions.map((q, i) => (
          <li key={q.id} className="text-[15px] text-ink">
            <span className="mr-2 text-ink-muted">{i + 1}.</span>
            <T text={q.text} />
            <span className="mt-1 block text-[13px] text-ink-muted">
              {i === 0
                ? 'Yes → the support screen with Tele-MANAS opens at once; the team is alerted; the report shows a support message first and no plan.'
                : 'Yes → the team is alerted; the counsellor sees it at the top of the attempt.'}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Ranges, plan, each scored section's report lines, next step and disclaimer. */
export function ReportView({ definition: def }: { definition: Definition }) {
  const scoredSections = def.sections.filter((s) => s.scored);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h2 className="text-[20px] font-semibold text-teal">Ranges</h2>
          <p className="mt-1 text-[13px] text-ink-muted">A section&apos;s score falls in one of these.</p>
          <ul className="mt-3 space-y-1 text-[14px] text-ink">
            {def.ranges.map((r, i) => (
              <li key={i}>
                {i === 0 ? 0 : def.ranges[i - 1].up_to + 1}–{r.up_to}%: <strong>{r.en}</strong>
                {r.hi && (
                  <span lang="hi" className="text-ink-soft">
                    {' '}
                    · {r.hi}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 sm:p-6">
          <h2 className="text-[20px] font-semibold text-teal">Plan</h2>
          <p className="mt-1 text-[13px] text-ink-muted">Picked by the range of the main area (the highest-scoring section).</p>
          {def.plan.length === 0 ? (
            <p className="mt-3 text-[14px] text-ink-muted">No plan: the report does not suggest a number of sessions.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-[14px] text-ink">
              {def.plan.map((p, i) => (
                <li key={i}>
                  Main area <strong>{def.ranges[p.range - 1]?.en ?? `range ${p.range}`}</strong> → {p.name.en}, {p.sessions} sessions, {p.pace.en}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="text-[20px] font-semibold text-teal">Section lines</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          The meaning line for the section&apos;s range is printed in the snapshot; the main area&apos;s focus lines go under “What sessions will work on”.
        </p>
        <div className="mt-2 space-y-5">
          {scoredSections.map((s) => (
            <div key={s.id} className="border-t border-sand pt-4 first:border-t-0">
              <h3 className="text-[16px] font-semibold text-ink">
                <T text={s.title} />
              </h3>
              {s.report && s.report.meaning.length > 0 ? (
                <dl className="mt-2 space-y-1.5 text-[14px]">
                  {s.report.meaning.map((m, i) => (
                    <div key={i} className="flex gap-3">
                      <dt className="w-24 shrink-0 font-semibold text-ink-soft">{def.ranges[i]?.en ?? `Range ${i + 1}`}</dt>
                      <dd className="text-ink">{m.en ? <T text={m} /> : <span className="text-ink-muted">no line</span>}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-1 text-[14px] text-ink-muted">No meaning lines: the snapshot shows only the score and range.</p>
              )}
              {s.report && s.report.focus.length > 0 && (
                <p className="mt-2 text-[14px] text-ink-soft">
                  <span className="font-semibold text-ink">Sessions will work on:</span> {s.report.focus.map((f) => f.en).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-5 text-[14px] text-ink sm:p-6">
        <p>
          <span className="font-semibold">Next step:</span> {def.closing ? <T text={def.closing} /> : <span className="text-ink-muted">none</span>}
        </p>
        <p>
          <span className="font-semibold">Disclaimer (cover band):</span> <T text={def.disclaimer} />
        </p>
      </Card>
    </div>
  );
}
