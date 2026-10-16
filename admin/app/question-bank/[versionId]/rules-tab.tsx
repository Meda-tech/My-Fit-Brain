import type { VersionConfig } from '@mfb/questionbank';
import { Card, Pill } from '../../../components/brand';
import {
  describeCondition,
  describeFlag,
  describeFlagEffects,
  describeFormatRule,
  describeOptionRule,
  describeOverride,
  describePointRule,
  describeVisibility,
  formatName,
  labelsFor,
} from '../../../lib/question-bank/sentences';
import { Empty, JsonDetails, Section } from './parts';

// Rules tab: every rule as a readable sentence generated from its JSON, with the JSON underneath.

function RuleCard({ title, children, json }: { title?: React.ReactNode; children: React.ReactNode; json: unknown }) {
  return (
    <Card shadow={false} className="p-4">
      {title && <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{title}</div>}
      <div className="text-[15px] leading-5.75 text-ink">{children}</div>
      <JsonDetails value={json} />
    </Card>
  );
}

const key = (k: string) => <span className="font-mono text-[14px] font-semibold text-teal">{k}</span>;

function tierLines(config: VersionConfig): string[] {
  let from = 0;
  return config.scoring.tier_thresholds.map((t) => {
    const range = t.max_points === null ? `${from}+ points` : `${from}–${t.max_points} points`;
    if (t.max_points !== null) from = t.max_points + 1;
    return `${range} → ${t.sessions} sessions`;
  });
}

export function RulesTab({ config }: { config: VersionConfig }) {
  const l = labelsFor(config);
  const s = config.scoring;
  const r = config.report_rules;

  return (
    <>
      <Section title="Scoring">
        <div className="space-y-3">
          <RuleCard title={key('Scale')} json={s.scale}>
            Likert {Object.entries(s.scale.likert).map(([c, v]) => `${c} = ${v}`).join(' · ')}; yes/no{' '}
            {Object.entries(s.scale.yn).map(([c, v]) => `${c} = ${v}`).join(' · ')}. Reverse items score {s.scale.reverse_max} − value.
          </RuleCard>
          <RuleCard title={key('Module % and bands')} json={{ bands: s.bands, rounding: s.rounding }}>
            Module % = item scores ÷ (max score × scored items shown) × 100, rounded {s.rounding.replace('_', ' ')}.{' '}
            {s.bands.map((b) => `${b.min}–${b.max} ${b.name_en}`).join(' · ')}.
          </RuleCard>
          <RuleCard title={key('Core module and path')} json={s.core_module}>
            {s.core_module.rules.map((rule, i) => (
              <span key={i} className="block">
                Core {l.module(rule.module)}{rule.path ? `, ${rule.path} path,` : ''} when {describeCondition(rule.when, l)}.
              </span>
            ))}
            <span className="block">
              {s.core_module.rules.length ? 'Otherwise' : 'Always'} core {l.module(s.core_module.default.module)}
              {s.core_module.default.path ? `, ${s.core_module.default.path} path` : ''}.
            </span>
          </RuleCard>
          <RuleCard title={key('Gate and primary module')} json={{ gate: s.gate, primary: s.primary }}>
            {s.gate.qid}: choose {s.gate.min_choices !== undefined ? `${s.gate.min_choices} to ${s.gate.max_choices}` : `up to ${s.gate.max_choices}`}.
            Primary = the chosen module with the highest band (tie → first chosen); if none is chosen, the core.
          </RuleCard>
          <RuleCard title={key('Tiers and pace')} json={{ tier_thresholds: s.tier_thresholds, pace: s.pace }}>
            {tierLines(config).join(' · ')}.
            {Object.entries(s.pace).map(([sessions, steps]) => (
              <span key={sessions} className="block">
                {sessions} sessions: {steps.map((p) => `${p.sessions} ${p.every === 'week' ? 'weekly' : 'fortnightly'}`).join(', then ')}.
              </span>
            ))}
          </RuleCard>
          <RuleCard title={key('Progress assessment')} json={s.progress}>
            Re-test after session{' '}
            {s.progress.schedule.map((x) => `${x.after_session}${x.plan_sessions ? ` (${x.plan_sessions}-session plans)` : ''}`).join(', ')}
            . Asks {[s.progress.items.core && 'the same core', s.progress.items.chosen_modules && 'the same chosen modules', ...s.progress.items.qids].filter(Boolean).join(', ')}
            ; reuses {s.progress.reuse_qids.join(', ')}. Change ≤ {s.progress.better_at} → {s.progress.texts.better} · ≥{' '}
            {s.progress.worse_at} → {s.progress.texts.worse} · otherwise {s.progress.texts.same}. ID suffix {s.progress.id_suffix}1, 2, 3.
          </RuleCard>
          <RuleCard title={key('From registration')} json={s.registration}>
            Age band → {s.registration.age_band_qid} ({s.registration.age_bands.map((b) => `${b.option_code}: ${b.min ?? '…'}–${b.max ?? '…'}`).join(' · ')}).
            Gender → {s.registration.sex_qid} ({Object.entries(s.registration.sex_options).map(([k, v]) => `${k} = ${v}`).join(' · ')}).
          </RuleCard>
        </div>
      </Section>

      <Section title="Points" count={config.point_rules.length}>
        <div className="space-y-3">
          {config.point_rules.map((p) => (
            <RuleCard key={p.key} title={<>{key(p.key)}<span className="text-[13px] text-ink-muted">{p.label}</span></>} json={p}>
              {describePointRule(p, l)}
            </RuleCard>
          ))}
        </div>
      </Section>

      <Section title="Tier overrides" count={config.overrides.length}>
        <div className="space-y-3">
          {config.overrides.map((o) => (
            <RuleCard key={o.key} title={key(o.key)} json={o}>{describeOverride(o, l)}</RuleCard>
          ))}
        </div>
      </Section>

      <Section title="Question visibility" count={config.visibility_rules.length}>
        <p className="-mt-1 mb-3 text-[13px] text-ink-muted">
          Besides these rules, a question shows only when its module is shown (intake, gate, dose, flags, the core, chosen
          modules) and its path matches.
        </p>
        <div className="space-y-3">
          {config.visibility_rules.length === 0 && <Empty>No extra visibility rules.</Empty>}
          {config.visibility_rules.map((v) => (
            <RuleCard key={v.qid} json={v}>{describeVisibility(v, l)}</RuleCard>
          ))}
        </div>
      </Section>

      <Section title="Option rules" count={config.option_rules.length}>
        <div className="space-y-3">
          {config.option_rules.map((o) => (
            <RuleCard key={`${o.qid}-${o.option_code}-${o.kind}`} json={o}>{describeOptionRule(o, l)}</RuleCard>
          ))}
        </div>
      </Section>

      <Section title="Flags" count={config.flags.length}>
        <div className="space-y-3">
          {config.flags.map((f) => (
            <RuleCard key={f.key} title={<>{key(f.key)}{f.is_protected && <Pill>Protected</Pill>}</>} json={f}>
              {describeFlag(f, l)}
              <ul className="mt-1 list-disc pl-5 text-[14px] text-ink-soft">
                {describeFlagEffects(f).map((e) => <li key={e}>{e}</li>)}
              </ul>
            </RuleCard>
          ))}
        </div>
      </Section>

      <Section title="Session format (first match wins)" count={config.format_rules.length}>
        <div className="space-y-3">
          {config.format_rules.map((f, i) => (
            <RuleCard key={f.key} title={<>{key(`${i + 1}. ${f.key}`)}</>} json={f}>{describeFormatRule(f, l)}</RuleCard>
          ))}
        </div>
      </Section>

      <Section title="Report rules">
        <div className="space-y-3">
          <RuleCard title={key('Strengths')} json={r.strengths}>
            Print up to {r.strengths.count}: reverse items answered Often, in this order: {r.strengths.priority.join(', ')}. Never invent one.
          </RuleCard>
          <RuleCard title={key('Stuck points')} json={r.stuck}>
            Print up to {r.stuck.count}: answers {r.stuck.answer_order.join(' then ')}, from {r.stuck.module_order.join(', then ')}.
          </RuleCard>
          <RuleCard title={key('Focus')} json={r.focus}>
            {r.focus.lines} lines from the primary module’s focus text; when the second module is at least{' '}
            {r.focus.second_module_min_band}, {r.focus.split_when_second[0]} from the primary and {r.focus.split_when_second[1]} from the second.
          </RuleCard>
          <RuleCard title={key('Closing tone')} json={r.tone}>
            {r.tone.ready_key} when {describeCondition(r.tone.condition, l)}; otherwise {r.tone.gentle_key}.
          </RuleCard>
          <RuleCard title={key('Interpretation')} json={r.interpretation}>
            Interpretation lines for {r.interpretation.order.join(', ')} (second only when at least {r.interpretation.second_min_band}).{' '}
            {r.interpretation.fallback === 'core'
              ? 'When a module has no text for its band, the core’s text for the core’s band is used (printed once).'
              : r.interpretation.fallback === 'none'
                ? 'When a module has no text for its band, nothing is printed for it.'
                : 'No fallback set.'}
          </RuleCard>
          <RuleCard title={key('Crisis layout')} json={r.layouts}>
            {r.layouts.crisis.top_block} first; hide {r.layouts.crisis.hide.join(', ')}; next step {r.layouts.crisis.next_key}.
          </RuleCard>
          <RuleCard title={key('Format texts')} json={r.format_texts}>
            {Object.keys(r.format_texts).length
              ? Object.entries(r.format_texts).map(([f, k]) => `${formatName(f)} → ${k}`).join(' · ')
              : 'None: the plan line names the format itself.'}
          </RuleCard>
          <RuleCard title={key('Report language')} json={r.report_language}>
            From {r.report_language.qid}: {Object.entries(r.report_language.map).map(([c, langs]) => `${l.option(r.report_language.qid, c)} → ${langs.join(' + ')}`).join(' · ')}.
          </RuleCard>
        </div>
      </Section>
    </>
  );
}
