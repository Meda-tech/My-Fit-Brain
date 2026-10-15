import { Lock } from 'lucide-react';
import type { VersionConfig } from '@mfb/questionbank';
import { Card, Pill } from '../../../components/brand';
import { BiText, Empty, Section } from './parts';

// Read-only content tabs: Questions, Report texts, Strengths & stuck, Plans & bands.

const PATH_LABELS: Record<string, string> = { all: 'All', partner: 'Partner path', solo: 'Solo path' };
const SCORED_LABELS: Record<string, string> = { yes: 'Scored', no: 'Not scored', points: 'Plan points' };

export function QuestionsTab({ config }: { config: VersionConfig }) {
  return (
    <>
      {config.modules.map((m) => {
        const questions = config.questions.filter((q) => q.module_code === m.code);
        return (
          <Section key={m.code} title={`${m.code} · ${m.name_en}`} count={questions.length}>
            <p lang="hi" className="-mt-2 mb-3 text-[14px] text-ink-muted">
              {m.name_hi} · kind: {m.kind.replace('_', ' ')}
            </p>
            <div className="space-y-3">
              {questions.map((q) => (
                <Card key={q.qid} shadow={false} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 font-mono text-[14px] font-semibold text-teal">{q.qid}</span>
                    <Pill tone="quiet">{q.type}</Pill>
                    <Pill tone={q.scored === 'no' ? 'quiet' : 'mist'}>{SCORED_LABELS[q.scored]}</Pill>
                    {q.reverse && <Pill>Reverse</Pill>}
                    {q.path !== 'all' && <Pill>{PATH_LABELS[q.path]}</Pill>}
                    {q.is_protected && (
                      <Pill>
                        <Lock size={12} strokeWidth={2} aria-hidden />
                        Protected
                      </Pill>
                    )}
                  </div>
                  <BiText en={q.text_en} hi={q.text_hi} />
                  <table className="mt-3 w-full text-left text-[13px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                        <th className="w-[22%] py-1 pr-2 font-semibold">Code</th>
                        <th className="py-1 pr-2 font-semibold">EN</th>
                        <th className="py-1 pr-2 font-semibold">HI</th>
                        <th className="w-12 py-1 text-right font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand">
                      {q.options.map((o) => (
                        <tr key={o.option_code}>
                          <td className="break-all py-1.5 pr-2 font-mono text-ink-muted">
                            {o.option_code}
                            {o.exclusive && (
                              <span className="ml-1.5 whitespace-nowrap font-body text-[11px] font-semibold uppercase tracking-[0.06em] text-teal">
                                exclusive
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-ink">{o.label_en}</td>
                          <td lang="hi" className="py-1.5 pr-2 text-ink-soft">{o.label_hi}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums text-ink">{o.value ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {q.source_note && (
                    <p className="mt-2 text-[13px] text-ink-muted">
                      <span className="font-medium">Excel note:</span> {q.source_note}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </Section>
        );
      })}
    </>
  );
}

export function TextsTab({ config }: { config: VersionConfig }) {
  const flagKeys = new Set(config.flags.map((f) => f.key));
  const report = config.texts.filter((t) => !flagKeys.has(t.key));
  const flags = config.texts.filter((t) => flagKeys.has(t.key));
  const list = (texts: typeof config.texts) => (
    <div className="space-y-3">
      {texts.map((t) => (
        <Card key={t.key} shadow={false} className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[14px] font-semibold text-teal">{t.key}</span>
            {t.module_code && <Pill tone="quiet">{t.module_code}</Pill>}
            {t.band && <Pill>{t.band}</Pill>}
          </div>
          <BiText en={t.text_en} hi={t.text_hi} />
        </Card>
      ))}
    </div>
  );
  return (
    <>
      <Section title="Report texts" count={report.length}>{report.length ? list(report) : <Empty>None.</Empty>}</Section>
      <Section title="Flag and safety texts" count={flags.length}>{flags.length ? list(flags) : <Empty>None.</Empty>}</Section>
    </>
  );
}

const TRIGGER_LABELS: Record<string, string> = {
  often: 'Answered Often',
  often_or_sometimes: 'Answered Often or Sometimes',
  often_sometimes_or_yes: 'Answered Often, Sometimes or Yes',
};

export function ItemTextsTab({ config }: { config: VersionConfig }) {
  return (
    <>
      {(['strength', 'stuck'] as const).map((kind) => {
        const items = config.item_texts.filter((t) => t.kind === kind);
        return (
          <Section key={kind} title={kind === 'strength' ? 'Strengths' : 'Stuck points'} count={items.length}>
            <div className="space-y-3">
              {items.map((t) => (
                <Card key={`${t.qid}-${t.kind}`} shadow={false} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 font-mono text-[14px] font-semibold text-teal">{t.qid}</span>
                    <Pill tone="quiet">{TRIGGER_LABELS[t.trigger] ?? t.trigger}</Pill>
                  </div>
                  <BiText en={t.text_en} hi={t.text_hi} />
                </Card>
              ))}
            </div>
          </Section>
        );
      })}
    </>
  );
}

export function PlansTab({ config }: { config: VersionConfig }) {
  return (
    <>
      <Section title="Session plans" count={config.tiers.length}>
        <div className="space-y-3">
          {config.tiers.map((t) => (
            <Card key={t.sessions} shadow={false} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Pill>{t.sessions} sessions</Pill>
              </div>
              <BiText en={<strong className="font-semibold">{t.plan_en}</strong>} hi={<strong className="font-semibold">{t.plan_hi}</strong>} />
              <div className="mt-1">
                <BiText en={t.pace_en} hi={t.pace_hi} />
              </div>
              {t.typical_case && <p className="mt-2 text-[13px] text-ink-muted">Typical case: {t.typical_case}</p>}
            </Card>
          ))}
        </div>
      </Section>
      <Section title="Bands" count={config.scoring.bands.length}>
        <Card shadow={false} className="overflow-hidden">
          <table className="w-full text-left text-[14px]">
            <thead className="bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Module %</th>
                <th className="px-4 py-2 font-semibold">EN</th>
                <th className="px-4 py-2 font-semibold">HI</th>
                <th className="px-4 py-2 text-right font-semibold">Severity points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand">
              {config.scoring.bands.map((b) => (
                <tr key={b.code}>
                  <td className="px-4 py-2 font-mono tabular-nums">{b.min}–{b.max}%</td>
                  <td className="px-4 py-2 text-ink">{b.name_en}</td>
                  <td lang="hi" className="px-4 py-2 text-ink-soft">{b.name_hi}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{b.severity_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>
    </>
  );
}
