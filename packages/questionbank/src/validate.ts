import { conditionRefs, type Condition } from './conditions';
import type { ImportPayload, ValidationIssue } from './types';

// Validates a full import payload (content + rules + test cases). Mirrors qb_validate_version() in
// the database, and also checks every rule reference so the import preview can show problems early.

/** Flags every version must keep (safety). Question protection comes from the data itself. */
export const PROTECTED_FLAGS = ['AGE_STOP', 'CRISIS', 'SAFETY'] as const;

export function validatePayload(p: ImportPayload, basedOn?: ImportPayload | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, ref: string | null = null) =>
    issues.push({ severity: 'error', code, message, ref });
  const warn = (code: string, message: string, ref: string | null = null) =>
    issues.push({ severity: 'warning', code, message, ref });

  const modules = new Set(p.modules.map((m) => m.code));
  const questions = new Map(p.questions.map((q) => [q.qid, q]));
  const optionsByQid = new Map<string, Set<string>>();
  for (const o of p.options) {
    if (!optionsByQid.has(o.qid)) optionsByQid.set(o.qid, new Set());
    optionsByQid.get(o.qid)!.add(o.option_code);
  }
  const textKeys = new Set(p.texts.map((t) => t.key));
  const flagKeys = new Set(p.flags.map((f) => f.key));

  // Hindi everywhere.
  for (const m of p.modules) if (!m.name_hi?.trim()) error('missing_hindi', `Module ${m.code} has no Hindi name.`, m.code);
  for (const q of p.questions) if (!q.text_hi?.trim()) error('missing_hindi', `${q.qid} has no Hindi text.`, q.qid);
  for (const o of p.options) {
    if (!o.label_hi?.trim()) error('missing_hindi', `${o.qid} option ${o.option_code} has no Hindi label.`, o.qid);
  }
  for (const t of p.texts) if (!t.text_hi?.trim()) error('missing_hindi', `Text ${t.key} has no Hindi.`, t.key);
  for (const t of p.item_texts) {
    if (!t.text_hi?.trim()) error('missing_hindi', `${t.kind} text for ${t.qid} has no Hindi.`, t.qid);
  }
  for (const t of p.tiers) {
    if (!t.plan_hi?.trim() || !t.pace_hi?.trim()) error('missing_hindi', `Tier ${t.sessions} has no Hindi plan or pace.`, String(t.sessions));
  }

  // Modules and questions.
  const seenModules = new Set<string>();
  for (const m of p.modules) {
    if (seenModules.has(m.code)) error('duplicate_module', `Module ${m.code} appears twice.`, m.code);
    seenModules.add(m.code);
    if (!m.kind) error('module_kind', `Module ${m.code} has no kind.`, m.code);
  }
  for (const q of p.questions) {
    if (!modules.has(q.module_code)) error('unknown_module', `${q.qid} uses unknown module ${q.module_code}.`, q.qid);
    const opts = p.options.filter((o) => o.qid === q.qid);
    if (opts.length === 0) error('no_options', `${q.qid} has no options.`, q.qid);
    if (q.type === 'likert') {
      const values = opts.map((o) => o.value).sort();
      if (opts.length !== 4 || values.join(',') !== '0,1,2,3') {
        error('likert_options', `${q.qid} (likert) must have exactly 4 options valued 0–3.`, q.qid);
      }
    }
    if (q.type === 'yn') {
      const no = opts.find((o) => o.option_code === 'no');
      const yes = opts.find((o) => o.option_code === 'yes');
      if (opts.length !== 2 || no?.value !== 0 || yes?.value !== 3) {
        error('yn_options', `${q.qid} (yn) must have options no = 0 and yes = 3.`, q.qid);
      }
    }
  }
  for (const o of p.options) {
    if (!questions.has(o.qid)) error('unknown_qid', `Option ${o.option_code} belongs to unknown question ${o.qid}.`, o.qid);
  }
  for (const t of p.texts) {
    if (t.module_code && !modules.has(t.module_code)) {
      error('unknown_module', `Text ${t.key} uses unknown module ${t.module_code}.`, t.key);
    }
  }
  for (const t of p.item_texts) {
    if (!questions.has(t.qid)) error('unknown_qid', `${t.kind} text points to unknown question ${t.qid}.`, t.qid);
  }

  // Rule references.
  const checkQid = (qid: string | null | undefined, where: string) => {
    if (qid && !questions.has(qid)) error('unknown_qid', `${where} refers to unknown question ${qid}.`, qid);
  };
  const checkOption = (qid: string, code: string, where: string) => {
    if (questions.has(qid) && !optionsByQid.get(qid)?.has(code)) {
      error('unknown_option', `${where} refers to unknown option ${qid}.${code}.`, qid);
    }
  };
  const checkText = (key: string | null | undefined, where: string) => {
    if (key && !textKeys.has(key)) error('unknown_text', `${where} refers to unknown text key ${key}.`, key);
  };
  const checkModule = (code: string, where: string) => {
    if (!modules.has(code)) error('unknown_module', `${where} refers to unknown module ${code}.`, code);
  };
  const reg = p.scoring.registration;
  const checkCondition = (c: Condition | null, where: string) => {
    if (!c) return;
    const refs = conditionRefs(c);
    for (const r of refs.questions) {
      checkQid(r.qid, where);
      for (const code of r.optionCodes) checkOption(r.qid, code, where);
    }
    for (const m of refs.modules) checkModule(m, where);
    for (const f of refs.flags) if (!flagKeys.has(f)) error('unknown_flag', `${where} refers to unknown flag ${f}.`, f);
    for (const b of refs.ageBands) checkOption(reg.age_band_qid, b, where);
    for (const s of refs.sexes) checkOption(reg.sex_qid, s, where);
  };

  const s = p.scoring;
  for (const r of s.core_module.rules) {
    checkCondition(r.when, 'Core module rule');
    checkModule(r.module, 'Core module rule');
  }
  checkModule(s.core_module.default.module, 'Core module default');
  checkQid(s.gate.qid, 'Gate');
  for (const q of [...s.progress.items.qids, ...s.progress.reuse_qids]) checkQid(q, 'Progress');
  for (const k of Object.values(s.progress.texts)) checkText(k, 'Progress');
  checkQid(reg.age_band_qid, 'Registration');
  checkQid(reg.sex_qid, 'Registration');
  for (const b of reg.age_bands) checkOption(reg.age_band_qid, b.option_code, 'Registration age bands');
  for (const code of Object.values(reg.sex_options)) checkOption(reg.sex_qid, code, 'Registration sex options');
  for (const t of s.tier_thresholds) {
    if (!p.tiers.some((x) => x.sessions === t.sessions)) {
      error('unknown_tier', `Tier threshold uses ${t.sessions} sessions but there is no such tier.`, String(t.sessions));
    }
    if (!s.pace[String(t.sessions)]) error('pace_missing', `No pace for the ${t.sessions}-session tier.`, String(t.sessions));
  }

  for (const r of p.point_rules) {
    checkQid(r.qid, `Point rule ${r.key}`);
    checkCondition(r.condition, `Point rule ${r.key}`);
  }
  for (const r of p.overrides) checkCondition(r.condition, `Override ${r.key}`);
  for (const r of p.visibility_rules) {
    checkQid(r.qid, 'Visibility rule');
    checkCondition(r.condition, `Visibility rule ${r.qid}`);
  }
  for (const r of p.option_rules) {
    checkQid(r.qid, 'Option rule');
    checkOption(r.qid, r.option_code, 'Option rule');
    checkCondition(r.condition, `Option rule ${r.qid}.${r.option_code}`);
  }
  for (const f of p.flags) {
    checkCondition(f.condition, `Flag ${f.key}`);
    checkText(f.effects.report_block, `Flag ${f.key}`);
    if ((f.effects.stop || f.effects.interrupt) && !textKeys.has(f.key)) {
      error('unknown_text', `Flag ${f.key} shows a screen but has no text with key ${f.key}.`, f.key);
    }
  }
  for (const r of p.format_rules) {
    checkCondition(r.condition, `Format rule ${r.key}`);
    checkText(r.add_text_key, `Format rule ${r.key}`);
  }
  const rr = p.report_rules;
  for (const q of rr.strengths.priority) {
    checkQid(q, 'Strengths priority');
    if (!p.item_texts.some((t) => t.qid === q && t.kind === 'strength')) {
      error('missing_strength_text', `Strengths priority lists ${q}, which has no STRENGTH text.`, q);
    }
  }
  checkCondition(rr.tone.condition, 'Tone');
  checkText(rr.tone.ready_key, 'Tone');
  checkText(rr.tone.gentle_key, 'Tone');
  checkText(rr.layouts.crisis.top_block, 'Crisis layout');
  checkText(rr.layouts.crisis.next_key, 'Crisis layout');
  for (const k of rr.layouts.crisis.hide) checkText(k, 'Crisis layout');
  for (const k of Object.values(rr.format_texts)) checkText(k, 'Format texts');
  checkQid(rr.report_language.qid, 'Report language');
  for (const code of Object.keys(rr.report_language.map)) checkOption(rr.report_language.qid, code, 'Report language');

  // Protected questions and flags.
  for (const key of PROTECTED_FLAGS) {
    const flag = p.flags.find((f) => f.key === key);
    if (!flag) error('protected_missing', `Protected flag ${key} is missing.`, key);
    else if (!flag.is_protected) error('protected_changed', `Flag ${key} must stay protected.`, key);
  }
  if (basedOn) {
    for (const old of basedOn.questions.filter((q) => q.is_protected)) {
      const now = questions.get(old.qid);
      if (!now) {
        error('protected_missing', `Protected question ${old.qid} is missing.`, old.qid);
        continue;
      }
      const shape = (pl: ImportPayload, qid: string) =>
        JSON.stringify(pl.options.filter((o) => o.qid === qid).map((o) => [o.option_code, o.value, o.sort]));
      if (!now.is_protected || now.type !== old.type || now.module_code !== old.module_code || shape(p, old.qid) !== shape(basedOn, old.qid)) {
        error('protected_changed', `Protected question ${old.qid} changed structure.`, old.qid);
      }
    }
    for (const old of basedOn.flags.filter((f) => f.is_protected)) {
      const now = p.flags.find((f) => f.key === old.key);
      if (!now) continue; // reported above for the fixed safety flags
      if (JSON.stringify(now.condition) !== JSON.stringify(old.condition) || JSON.stringify(now.effects) !== JSON.stringify(old.effects)) {
        error('protected_changed', `Protected flag ${old.key} changed.`, old.key);
      }
    }
  }

  // Test cases refer to real questions and options.
  for (const tc of p.test_cases) {
    for (const [qid, answer] of Object.entries(tc.answers)) {
      if (!questions.has(qid)) {
        warn('test_case_qid', `Test case "${tc.name}" answers unknown question ${qid}.`, qid);
        continue;
      }
      for (const code of Array.isArray(answer) ? answer : [answer]) {
        if (!optionsByQid.get(qid)?.has(code)) warn('test_case_option', `Test case "${tc.name}" uses unknown option ${qid}.${code}.`, qid);
      }
    }
    for (const m of Object.keys(tc.expected.bands)) {
      if (!modules.has(m)) warn('test_case_module', `Test case "${tc.name}" expects a band for unknown module ${m}.`, m);
    }
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
