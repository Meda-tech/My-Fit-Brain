import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { describeShowWhen, SAFETY_SECTION, type Definition, type Issue, type Text } from '@mfb/questionnaire';
import { Card, Notice, Pill } from '../../../components/brand';

// The whole questionnaire as one readable page: what the client sees, in order, what opens what, the
// values behind each option, counsellor notes, and the report settings. No ids or technical words.

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

export function QuestionnaireView({ definition, warnings }: { definition: Definition; warnings: Issue[] }) {
  const def = definition;
  const scoredSections = def.sections.filter((s) => s.scored);
  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <Notice variant="info" icon={<AlertTriangle size={18} strokeWidth={2} />} title={`${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check (nothing blocks publishing)`}>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px]">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="font-semibold">{w.where}:</span> {w.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}

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
          {def.sections.length} sections · {def.sections.reduce((n, s) => n + s.questions.length, 0)} questions, then the two built-in safety questions.
        </p>
      </Card>

      {def.sections.map((s, si) => (
        <Card key={s.id} className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-[20px] font-semibold leading-[1.3] text-teal">
              {si + 1}. <T text={s.title} />
            </h2>
            <Pill tone={s.scored ? 'mist' : 'quiet'}>{s.scored ? 'Scored' : 'Not scored'}</Pill>
          </div>
          <p className="mt-1 text-[14px] text-ink-muted">{describeShowWhen(def, s.show_when)}</p>

          <ol className="mt-4 divide-y divide-sand">
            {s.questions.map((q, qi) => (
              <li key={q.id} className="py-4 first:pt-0 last:pb-0">
                <p className="text-[16px] font-medium text-ink">
                  <span className="mr-2 text-ink-muted">
                    {si + 1}.{qi + 1}
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
        </Card>
      ))}

      <Card className="border-teal/30 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} strokeWidth={2} className="text-teal" aria-hidden />
          <h2 className="text-[20px] font-semibold text-teal">Built in: safety (always asked last)</h2>
        </div>
        <ol className="mt-3 space-y-3">
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

      <Card className="p-5 sm:p-6">
        <h2 className="text-[20px] font-semibold text-teal">Report</h2>
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Ranges</h3>
            <ul className="mt-2 space-y-1 text-[14px] text-ink">
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
          </div>
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Plan</h3>
            {def.plan.length === 0 ? (
              <p className="mt-2 text-[14px] text-ink-muted">No plan: the report does not suggest a number of sessions.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[14px] text-ink">
                {def.plan.map((p, i) => (
                  <li key={i}>
                    Main area <strong>{def.ranges[p.range - 1]?.en ?? `range ${p.range}`}</strong> → {p.name.en}, {p.sessions} sessions, {p.pace.en}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {scoredSections.map((s) => (
            <div key={s.id} className="border-t border-sand pt-4">
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

        <div className="mt-6 space-y-3 border-t border-sand pt-4 text-[14px] text-ink">
          <p>
            <span className="font-semibold">Next step:</span> {def.closing ? <T text={def.closing} /> : <span className="text-ink-muted">none</span>}
          </p>
          <p>
            <span className="font-semibold">Disclaimer (cover band):</span> <T text={def.disclaimer} />
          </p>
        </div>
      </Card>
    </div>
  );
}
