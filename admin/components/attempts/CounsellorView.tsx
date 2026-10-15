import type { AssessmentResult } from '@mfb/engine';
import type { VersionConfig } from '@mfb/questionbank';
import { Card, Pill } from '../brand';
import type { AttemptAnswer, AttemptEvent } from '../../lib/services/attempts';
import { formatDateTime } from './AttemptStatusPill';

// Staff-only details of an attempt. Never shown to clients; the client report is separate.

const h2 = 'text-[20px] font-semibold text-teal';
const h3 = 'mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted';
const th = 'whitespace-nowrap px-3 py-2 font-semibold';
const td = 'px-3 py-2 align-top';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-sand pt-5">
      <h3 className={h3}>{title}</h3>
      {children}
    </section>
  );
}

export function CounsellorView({
  result,
  config,
  answers,
  events,
}: {
  result: AssessmentResult | null;
  config: VersionConfig | null;
  answers: AttemptAnswer[];
  events: AttemptEvent[];
}) {
  const moduleName = (code: string) => config?.modules.find((m) => m.code === code)?.name_en ?? code;
  const question = (qid: string) => config?.questions.find((q) => q.qid === qid);
  const optionLabel = (qid: string, code: string) =>
    question(qid)?.options.find((o) => o.option_code === code)?.label_en ?? code;
  const showValue = (qid: string, v: string | string[]) =>
    (Array.isArray(v) ? v : [v]).map((c) => `${optionLabel(qid, c)} (${c})`).join(', ');

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div>
        <h2 className={h2}>Counsellor view</h2>
        <p className="mt-1 text-[14px] text-ink-muted">For the care team only. Clients never see this panel.</p>
      </div>

      {result ? (
        <>
          <Section title="Modules">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-sand text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                    <th className={th}>Module</th>
                    <th className={th}>Score</th>
                    <th className={th}>%</th>
                    <th className={th}>Band</th>
                    <th className={th}>Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {Object.entries(result.modules).map(([code, m]) => (
                    <tr key={code}>
                      <td className={td}>
                        {moduleName(code)} <span className="font-mono text-[12px] text-ink-muted">{code}</span>
                        {code === result.primary && <Pill className="ml-2">primary</Pill>}
                        {code === result.second && <Pill tone="quiet" className="ml-2">second</Pill>}
                      </td>
                      <td className={td}>
                        {m.sum} / {m.max}
                      </td>
                      <td className={td}>{m.percent ?? '—'}</td>
                      <td className={td}>{m.band ?? '—'}</td>
                      <td className={td}>
                        {m.scoredItems} scored / {m.shownItems} shown
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[13px] text-ink-muted">
              Mode {result.mode} · path {result.path ?? '—'} · core {result.coreModule} · chosen{' '}
              {result.chosenModules.join(', ') || '—'} · layout {result.layout}
            </p>
          </Section>

          <Section title="Points and tier">
            {result.points ? (
              <ul className="space-y-1 text-[14px] text-ink-soft">
                {result.points.breakdown.map((p) => (
                  <li key={p.key}>
                    <span className="font-mono text-[12px] text-ink-muted">{p.key}</span> {p.label}: {p.points}
                  </li>
                ))}
                <li className="font-semibold text-ink">Total: {result.points.total}</li>
              </ul>
            ) : (
              <p className="text-[14px] text-ink-muted">No points in this mode.</p>
            )}
            <p className="mt-3 text-[14px] text-ink">
              Tier before overrides: <strong>{result.tierBeforeOverrides ?? '—'}</strong> · final tier:{' '}
              <strong>{result.tier ?? '—'}</strong>
            </p>
            {result.overridesApplied.length > 0 && (
              <ul className="mt-1 text-[14px] text-ink-soft">
                {result.overridesApplied.map((o) => (
                  <li key={o.key}>
                    Override <span className="font-mono text-[12px]">{o.key}</span>: {o.from} → {o.to}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Format">
            {result.format ? (
              <p className="text-[14px] text-ink">
                {result.format.type}
                {result.format.split ? ` (${result.format.split.individual} individual + ${result.format.split.couple} couple)` : ''} ·
                decided by {result.format.source.kind} <span className="font-mono text-[12px]">{result.format.source.key}</span>
              </p>
            ) : (
              <p className="text-[14px] text-ink-muted">No format.</p>
            )}
          </Section>

          <Section title="Flags and tags">
            {result.flags.length === 0 && result.counsellor.tags.length === 0 ? (
              <p className="text-[14px] text-ink-muted">None.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {result.flags.map((f) => (
                  <Pill key={f.key}>{f.key}</Pill>
                ))}
                {result.counsellor.tags
                  .filter((tag) => !result.flags.some((f) => f.key === tag))
                  .map((tag) => (
                    <Pill key={tag} tone="quiet">
                      {tag}
                    </Pill>
                  ))}
              </div>
            )}
            {result.notify.length > 0 && (
              <p className="mt-2 text-[13px] text-ink-muted">
                Notify: {result.notify.map((n) => `${n.flag} → ${n.recipients.join(', ')}`).join(' · ')}
              </p>
            )}
          </Section>

          <Section title="Readiness">
            <p className="text-[14px] text-ink">
              {result.counsellor.readiness
                ? `${question(result.counsellor.readiness.qid)?.text_en ?? result.counsellor.readiness.qid}: ${optionLabel(
                    result.counsellor.readiness.qid,
                    result.counsellor.readiness.answer
                  )}`
                : '—'}
            </p>
          </Section>

          {result.warnings.length > 0 && (
            <Section title="Engine warnings">
              <ul className="text-[13px] text-ink-soft">
                {result.warnings.map((w, i) => (
                  <li key={i}>
                    <span className="font-mono">{w.code}</span> {w.message}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      ) : (
        <p className="text-[14px] text-ink-muted">No result yet. The client has not finished this assessment.</p>
      )}

      <Section title="Safety events">
        {events.length === 0 ? (
          <p className="text-[14px] text-ink-muted">None.</p>
        ) : (
          <ul className="space-y-1 text-[14px] text-ink">
            {events.map((e) => (
              <li key={e.id}>
                <strong>{e.kind}</strong> <span className="font-mono text-[12px]">{e.flag_key}</span> · {formatDateTime(e.created_at)} ·{' '}
                {e.handled_at ? `handled ${formatDateTime(e.handled_at)}` : 'not yet handled'}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Answers">
        {answers.length === 0 ? (
          <p className="text-[14px] text-ink-muted">No answers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[14px]">
              <thead>
                <tr className="border-b border-sand text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  <th className={th}>ID</th>
                  <th className={th}>Question</th>
                  <th className={th}>Answer</th>
                  <th className={th}>From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand">
                {answers.map((a) => (
                  <tr key={a.qid}>
                    <td className={`${td} font-mono text-[12px] text-ink-muted`}>{a.qid}</td>
                    <td className={`${td} text-ink-soft`}>{question(a.qid)?.text_en ?? '—'}</td>
                    <td className={`${td} text-ink`}>{showValue(a.qid, a.value)}</td>
                    <td className={`${td} text-ink-muted`}>{a.source === 'profile' ? 'Registration' : 'Client'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Card>
  );
}
