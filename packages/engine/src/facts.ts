import type { BandName, Condition, QbModule, QbOption, QbQuestion, VersionConfig } from '@mfb/questionbank';
import { evaluateCondition, isTrue, type TriState } from './conditions';
import { AnswerIssue, ConfigError } from './errors';
import type { Answers, EngineContext, FlowItem, FlowOption, ModuleResult, Path, Warning } from './types';

// Facts about one client's answers, derived only from the VersionConfig. Built in stages so that
// later facts (bands, flags) never feed back into earlier ones (path, visibility).

type Question = QbQuestion & { options: QbOption[] };

export class ConfigIndex {
  private readonly questions = new Map<string, Question>();
  private readonly modules = new Map<string, QbModule>();
  private readonly ranks = new Map<string, number>();
  readonly visibility = new Map<string, Condition>();

  constructor(readonly config: VersionConfig) {
    for (const q of config.questions) this.questions.set(q.qid, q);
    for (const m of config.modules) this.modules.set(m.code, m);
    config.scoring.bands.forEach((b, i) => this.ranks.set(b.code, i));
    for (const v of config.visibility_rules) this.visibility.set(v.qid, v.condition);
  }

  question(qid: string): Question {
    const q = this.questions.get(qid);
    if (!q) throw new ConfigError(`unknown question ${qid}`);
    return q;
  }

  hasQuestion(qid: string): boolean {
    return this.questions.has(qid);
  }

  module(code: string): QbModule {
    const m = this.modules.get(code);
    if (!m) throw new ConfigError(`unknown module ${code}`);
    return m;
  }

  hasModule(code: string): boolean {
    return this.modules.has(code);
  }

  bandRank(band: string): number {
    const r = this.ranks.get(band);
    if (r === undefined) throw new ConfigError(`unknown band ${band}`);
    return r;
  }

  bandFor(percent: number): BandName {
    const band = this.config.scoring.bands.find((b) => percent >= b.min && percent <= b.max);
    if (!band) throw new ConfigError(`no band covers ${percent}%`);
    return band.code;
  }

  questionsOf(module: string): Question[] {
    return this.config.questions.filter((q) => q.module_code === module);
  }
}

const indexCache = new WeakMap<VersionConfig, ConfigIndex>();
export function indexFor(config: VersionConfig): ConfigIndex {
  let index = indexCache.get(config);
  if (!index) {
    index = new ConfigIndex(config);
    indexCache.set(config, index);
  }
  return index;
}

export interface Facts {
  index: ConfigIndex;
  /** Complete: unanswered questions count as "not answered". Partial: they are unknown. */
  complete: boolean;
  /** Answers plus registration and reused answers. */
  answers: Answers;
  /** Gender as an option code of the sex question. */
  sex: string | null;
  age: number;
  ageBand: string | null;
  /** undefined = not knowable yet; null = the test has no paths. */
  path: Path | null | undefined;
  coreModule: string | undefined;
  /** Chosen modules in the order chosen; undefined = gate not answered yet. */
  chosen: string[] | undefined;
  modules: Map<string, ModuleResult>;
  /** Band per scored module (core and chosen): null = no %, 'unknown' = not complete yet. */
  bands: Map<string, BandName | null | 'unknown'>;
  bandsReady: boolean;
  primary: string | null | undefined;
  second: string | null | undefined;
  flags: Map<string, TriState>;
  flagsReady: boolean;
}

export interface Analysis {
  facts: Facts;
  flow: FlowItem[];
  issues: AnswerIssue[];
  warnings: Warning[];
  /** Questions answered from registration or reused from the first assessment. */
  prefilled: Set<string>;
}

const PHASES: Record<string, number> = {
  intake: 0,
  gate: 1,
  core: 2,
  solo_core: 2,
  couple: 3,
  individual: 3,
  dose: 4,
  flag: 5,
};

/** Builds facts and the visible flow. `complete` is used when scoring a finished assessment. */
export function analyse(
  config: VersionConfig,
  context: EngineContext,
  answers: Answers,
  options: { complete?: boolean } = {}
): Analysis {
  const index = indexFor(config);
  const scoring = config.scoring;
  const reg = scoring.registration;
  const warnings: Warning[] = [];
  const issues: AnswerIssue[] = [];
  const prefilled = new Set<string>();

  if (context.mode === 'progress' && !context.firstResult) {
    throw new Error('Progress mode needs the first assessment result (context.firstResult).');
  }
  const first = context.firstResult;

  // Stage 1: registration, reused answers.
  const sex = reg.sex_options[context.sex] ?? null;
  if (sex === null) warnings.push({ code: 'SEX_NOT_MAPPED', message: `Registration gender "${context.sex}" has no option in ${reg.sex_qid}.` });
  const ageBand =
    reg.age_bands.find((b) => (b.min === null || context.age >= b.min) && (b.max === null || context.age <= b.max))
      ?.option_code ?? null;
  if (ageBand === null) warnings.push({ code: 'AGE_NOT_MAPPED', message: `Age ${context.age} is in no age band of ${reg.age_band_qid}.` });

  const effective: Answers = { ...answers };
  if (context.mode === 'progress' && first) {
    for (const qid of scoring.progress.reuse_qids) {
      const reused = first.counsellor.rawAnswers[qid];
      if (reused !== undefined) {
        effective[qid] = reused;
        prefilled.add(qid);
      }
    }
  }
  for (const [qid, value] of [
    [reg.sex_qid, sex],
    [reg.age_band_qid, ageBand],
  ] as const) {
    if (value === null) continue;
    const given = answers[qid];
    if (given !== undefined && given !== value) {
      warnings.push({
        code: 'REGISTRATION_ANSWER_MISMATCH',
        message: `${qid} was answered "${String(given)}" but registration gives "${value}"; registration is used.`,
      });
    }
    effective[qid] = value;
    prefilled.add(qid);
  }

  const facts: Facts = {
    index,
    complete: options.complete ?? false,
    answers: effective,
    sex,
    age: context.age,
    ageBand,
    path: undefined,
    coreModule: undefined,
    chosen: undefined,
    modules: new Map(),
    bands: new Map(),
    bandsReady: false,
    primary: undefined,
    second: undefined,
    flags: new Map(),
    flagsReady: false,
  };

  // Stage 2: core module and path.
  if (context.mode === 'progress' && first) {
    facts.coreModule = first.coreModule;
    facts.path = first.path;
  } else {
    let decided = false;
    for (const rule of scoring.core_module.rules) {
      const r = evaluateCondition(rule.when, facts);
      if (r === 'unknown') {
        decided = true; // not knowable yet
        break;
      }
      if (r) {
        facts.coreModule = rule.module;
        facts.path = rule.path;
        decided = true;
        break;
      }
    }
    if (!decided) {
      facts.coreModule = scoring.core_module.default.module;
      facts.path = scoring.core_module.default.path;
    }
  }
  if (facts.coreModule !== undefined) index.module(facts.coreModule);

  // Stage 3: chosen modules (gate option codes are module codes).
  const gate = scoring.gate;
  if (context.mode === 'progress' && first) {
    facts.chosen = [...first.chosenModules];
  } else {
    const raw = effective[gate.qid];
    if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
      facts.chosen = facts.complete ? [] : undefined;
    } else {
      const codes = Array.isArray(raw) ? raw : [raw];
      facts.chosen = codes.filter((c, i) => index.hasModule(c) && codes.indexOf(c) === i);
    }
  }
  for (const m of facts.chosen ?? []) {
    const kind = index.module(m).kind;
    if (kind !== 'couple' && kind !== 'individual') throw new ConfigError(`gate option ${m} is a ${kind} module`);
  }

  // Stage 4: the visible flow (band and flag facts are not known yet: they read as unknown).
  const flow = buildFlow(config, context, facts, prefilled, issues);

  // Stage 5: module scores and bands for the core and the chosen modules.
  const scoredModules = facts.coreModule === undefined ? [] : [facts.coreModule, ...(facts.chosen ?? [])];
  for (const m of scoredModules) {
    const items = flow.filter((f) => f.module === m);
    const scored = items.filter((f) => f.scored === 'yes');
    if (scored.some((f) => !f.answered)) {
      facts.bands.set(m, 'unknown');
      continue;
    }
    let sum = 0;
    for (const item of scored) sum += itemScore(config, index.question(item.qid), effective[item.qid]);
    const max = scoring.scale.reverse_max * scored.length;
    const percent = max > 0 ? roundPercent(sum, max) : null;
    const band = percent === null ? null : index.bandFor(percent);
    if (percent === null) warnings.push({ code: 'MODULE_NOT_SCORED', message: `Module ${m} has no scored questions shown.` });
    facts.modules.set(m, { scoredItems: scored.length, shownItems: items.length, sum, max, percent, band });
    facts.bands.set(m, band);
  }
  facts.bandsReady = true;

  // Stage 6: primary and second module.
  if (facts.chosen === undefined || facts.coreModule === undefined) {
    facts.primary = undefined;
    facts.second = undefined;
  } else if (facts.chosen.length === 0) {
    facts.primary = facts.coreModule;
    facts.second = null;
  } else {
    const bands = facts.chosen.map((m) => facts.bands.get(m));
    if (bands.some((b) => b === 'unknown' || b === undefined)) {
      facts.primary = undefined;
      facts.second = undefined;
    } else {
      let best = facts.chosen[0];
      for (const m of facts.chosen) {
        const b = facts.bands.get(m) as BandName | null;
        const current = facts.bands.get(best) as BandName | null;
        if (b !== null && (current === null || index.bandRank(b) > index.bandRank(current))) best = m;
      }
      facts.primary = best;
      facts.second = facts.chosen.find((m) => m !== best) ?? null;
    }
  }

  // Stage 7: flags in sort order (a flag may refer to earlier flags).
  facts.flagsReady = true;
  for (const flag of config.flags) facts.flags.set(flag.key, evaluateCondition(flag.condition, facts));

  return { facts, flow, issues, warnings, prefilled };
}

/** Item score: option value; reverse items score reverse_max − value. */
export function itemScore(config: VersionConfig, question: Question, answer: string | string[] | undefined): number {
  const code = Array.isArray(answer) ? answer[0] : answer;
  const option = question.options.find((o) => o.option_code === code);
  if (!option) throw new ConfigError(`answer ${String(code)} is not an option of ${question.qid}`);
  if (option.value === null) throw new ConfigError(`scored question ${question.qid} has an option without a value`);
  return question.reverse ? config.scoring.scale.reverse_max - option.value : option.value;
}

/** The band of a module % per qb_scoring.bands. */
export function bandFor(config: VersionConfig, percent: number): BandName {
  return indexFor(config).bandFor(percent);
}

/** sum ÷ max × 100, rounded half up, in exact integer arithmetic (25.5 → 26). */
export function roundPercent(sum: number, max: number): number {
  return Math.floor((200 * sum + max) / (2 * max));
}

function buildFlow(
  config: VersionConfig,
  context: EngineContext,
  facts: Facts,
  prefilled: Set<string>,
  issues: AnswerIssue[]
): FlowItem[] {
  const index = facts.index;
  const scoring = config.scoring;
  const progress = context.mode === 'progress';

  // Modules in flow order: intake → gate → core → chosen modules (in the order chosen) → dose → flag.
  const byPhase = [...config.modules].sort((a, b) => PHASES[a.kind] - PHASES[b.kind] || a.sort - b.sort);
  const chosen = (facts.chosen ?? []).map((c) => index.module(c));
  const ordered: QbModule[] = [];
  for (const m of byPhase) {
    if (m.kind === 'core' || m.kind === 'solo_core') {
      if (m.code === facts.coreModule) ordered.push(m);
    } else if (m.kind !== 'couple' && m.kind !== 'individual') {
      ordered.push(m);
    }
  }
  const at = ordered.findIndex((m) => PHASES[m.kind] > PHASES.couple);
  ordered.splice(at === -1 ? ordered.length : at, 0, ...chosen);

  // Progress mode asks only the same core, the same chosen modules and the listed questions.
  const progressQids = new Set(scoring.progress.items.qids);
  const include = (q: Question, m: QbModule): boolean => {
    if (!progress) return true;
    if (m.kind === 'core' || m.kind === 'solo_core') return scoring.progress.items.core;
    if (m.kind === 'couple' || m.kind === 'individual') return scoring.progress.items.chosen_modules;
    return progressQids.has(q.qid);
  };
  const questions: Question[] = [];
  for (const m of ordered) {
    for (const q of index.questionsOf(m.code).sort((a, b) => a.sort - b.sort)) {
      if (include(q, m)) questions.push(q);
    }
  }

  const flow: FlowItem[] = [];
  for (const q of questions) {
    if (q.path !== 'all' && (facts.path === undefined || facts.path === null || facts.path !== q.path)) continue;
    const rule = index.visibility.get(q.qid);
    if (rule && !isTrue(evaluateCondition(rule, facts))) continue;

    const options = visibleOptions(config, q, facts);
    const answer = facts.answers[q.qid];
    const answered = answer !== undefined && !(Array.isArray(answer) && answer.length === 0);
    const item: FlowItem = {
      qid: q.qid,
      module: q.module_code,
      moduleKind: index.module(q.module_code).kind,
      type: q.type,
      reverse: q.reverse,
      scored: q.scored,
      text_en: q.text_en,
      text_hi: q.text_hi,
      options,
      answered,
      prefilled: prefilled.has(q.qid),
    };
    if (q.qid === scoring.gate.qid) {
      item.minChoices = scoring.gate.min_choices ?? 0;
      item.maxChoices = scoring.gate.max_choices;
    }
    if (answered) checkAnswer(item, q, answer, issues);
    flow.push(item);
  }
  return flow;
}

function visibleOptions(config: VersionConfig, q: Question, facts: Facts): FlowOption[] {
  const rules = config.option_rules.filter((r) => r.qid === q.qid);
  const hidden = new Set(rules.filter((r) => r.kind === 'hide' && isTrue(evaluateCondition(r.condition, facts))).map((r) => r.option_code));
  const first = rules.filter((r) => r.kind === 'order_first' && isTrue(evaluateCondition(r.condition, facts))).map((r) => r.option_code);
  const options = [...q.options]
    .sort((a, b) => a.sort - b.sort)
    .filter((o) => !hidden.has(o.option_code))
    .map((o) => ({ code: o.option_code, label_en: o.label_en, label_hi: o.label_hi, value: o.value, exclusive: o.exclusive === true }));
  const front = first.map((code) => options.find((o) => o.code === code)).filter((o): o is FlowOption => !!o);
  return [...front, ...options.filter((o) => !first.includes(o.code))];
}

function checkAnswer(item: FlowItem, q: Question, answer: string | string[], issues: AnswerIssue[]) {
  const visible = new Set(item.options.map((o) => o.code));
  const all = new Set(q.options.map((o) => o.option_code));
  const issue = (code: string, message: string) => issues.push({ qid: q.qid, code, message });
  const codes = Array.isArray(answer) ? answer : [answer];

  if (q.type === 'multi') {
    if (!Array.isArray(answer)) issue('NOT_A_LIST', 'a multi-select answer must be a list of option codes');
    if (new Set(codes).size !== codes.length) issue('DUPLICATE_CHOICE', 'the same option is chosen twice');
    const exclusive = item.options.filter((o) => o.exclusive && codes.includes(o.code));
    if (exclusive.length > 0 && codes.length > 1) {
      issue('EXCLUSIVE_COMBINED', `option ${exclusive[0].code} cannot be combined with other options`);
    }
  } else if (Array.isArray(answer)) {
    if (answer.length !== 1) issue('NOT_SINGLE', 'only one option can be chosen');
  }
  for (const code of codes) {
    if (!all.has(code)) issue('UNKNOWN_OPTION', `${code} is not an option`);
    else if (!visible.has(code)) issue('OPTION_HIDDEN', `${code} is not offered to this client`);
  }
  if (item.minChoices !== undefined && codes.length < item.minChoices) {
    issue('TOO_FEW_CHOICES', `choose at least ${item.minChoices}`);
  }
  if (item.maxChoices !== undefined && codes.length > item.maxChoices) {
    issue('TOO_MANY_CHOICES', `choose at most ${item.maxChoices}`);
  }
}
