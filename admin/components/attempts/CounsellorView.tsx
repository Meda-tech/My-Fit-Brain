import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { CounsellorView as ViewData } from '@mfb/questionnaire';
import { Card, Notice, Pill } from '../brand';
import type { AttemptAlert } from '../../lib/services/attempts';
import { formatDateTime } from './AttemptStatusPill';

// Staff-only details of an attempt. Never shown to clients. Coordinators see the alerts only.

const h3 = 'mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted';
const th = 'whitespace-nowrap px-3 py-2 font-semibold';
const td = 'px-3 py-2 align-top';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-sand pt-5 first:border-t-0 first:pt-0">
      <h3 className={h3}>{title}</h3>
      {children}
    </section>
  );
}

const ALERT_TITLES: Record<AttemptAlert['kind'], string> = { crisis: 'Crisis: thoughts of self-harm', home_safety: 'Home safety: feels unsafe at home' };

export function AlertsList({ alerts }: { alerts: AttemptAlert[] }) {
  if (alerts.length === 0) return <p className="text-[14px] text-ink-muted">No safety alerts.</p>;
  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li key={a.id}>
          <Notice variant={a.kind === 'crisis' ? 'error' : 'medical'} icon={<ShieldAlert size={18} strokeWidth={2} />} title={ALERT_TITLES[a.kind]}>
            Raised {formatDateTime(a.created_at)}
            {a.handled_at ? ` · handled ${formatDateTime(a.handled_at)}` : ' · not yet handled'}
            {a.kind === 'crisis' ? '. Call the client within 4 working hours (after 8 PM: by 10 AM next day). Tele-MANAS 14416 / 1-800-891-4416.' : '. Individual sessions only; discuss safe next steps privately. Emergency 112, Women Helpline 181.'}
          </Notice>
        </li>
      ))}
    </ul>
  );
}

export function CounsellorView({ view, alerts }: { view: ViewData | null; alerts: AttemptAlert[] }) {
  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <Section title="Alerts and notes">
        <AlertsList alerts={alerts} />
        {view && view.notes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {view.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 rounded-input bg-cream px-3 py-2 text-[14px] text-ink">
                <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-coral-deep" aria-hidden />
                <span>
                  <span className="font-semibold">{n.note}</span>
                  <span className="block text-[13px] text-ink-muted">
                    {n.number ? `${n.number} ` : ''}
                    {n.question} — {n.answer}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!view ? (
        <Section title="Result">
          <p className="text-[14px] text-ink-muted">No result yet. The client has not finished this assessment.</p>
        </Section>
      ) : (
        <>
          <Section title="Plan and main area">
            <p className="text-[15px] text-ink">
              {view.main ? (
                <>
                  Main area: <strong>{view.main.title}</strong>
                  {view.main.score !== null ? ` — ${view.main.score}% · ${view.main.range}` : ''}
                </>
              ) : (
                'No main area (no scored section had enough answers).'
              )}
            </p>
            <p className="mt-1 text-[15px] text-ink">
              {view.plan ? (
                <>
                  Plan: <strong>{view.plan.name}</strong> — {view.plan.sessions} sessions, {view.plan.pace}
                </>
              ) : (
                'No plan row for this result.'
              )}
            </p>
          </Section>

          <Section title="Sections">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-sand text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                    <th className={th}>Section</th>
                    <th className={th}>Score</th>
                    <th className={th}>Range</th>
                    <th className={th}>Answered</th>
                    <th className={th}>Skipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {view.sections.map((s) => (
                    <tr key={s.id}>
                      <td className={td}>
                        {s.title}
                        {view.main?.title === s.title && s.scored && <Pill className="ml-2">main</Pill>}
                        {!s.scored && <Pill tone="quiet" className="ml-2">not scored</Pill>}
                      </td>
                      <td className={td}>{s.score === null ? (s.scored ? 'Not enough answers' : '—') : `${s.score}%`}</td>
                      <td className={td}>{s.range ?? '—'}</td>
                      <td className={td}>
                        {s.answered} / {s.shownQuestions}
                      </td>
                      <td className={td}>{s.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Notable answers (highest first)">
            {view.notable.length === 0 ? (
              <p className="text-[14px] text-ink-muted">No answers with a value.</p>
            ) : (
              <ul className="divide-y divide-sand text-[14px]">
                {view.notable.map((n, i) => (
                  <li key={i} className="flex items-start justify-between gap-4 py-2">
                    <span className="text-ink">
                      <span className="mr-2 text-ink-muted">{n.number}</span>
                      {n.question} — <strong>{n.answer}</strong>
                    </span>
                    <span className="shrink-0 font-mono text-[12px] text-ink-muted">{n.percent}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="All answers">
            <div className="space-y-4">
              {view.answers.map((group) => (
                <div key={group.section}>
                  <p className="text-[14px] font-semibold text-teal">{group.section}</p>
                  <ul className="mt-1 divide-y divide-sand text-[14px]">
                    {group.items.map((a, i) => (
                      <li key={i} className="flex items-start justify-between gap-4 py-1.5">
                        <span className="text-ink-soft">
                          <span className="mr-2 text-ink-muted">{a.number}</span>
                          {a.question}
                        </span>
                        <span className="shrink-0 text-right text-ink">
                          {a.answer}
                          {a.skipped && <span className="ml-1 text-[12px] text-ink-muted">(not counted)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </Card>
  );
}
