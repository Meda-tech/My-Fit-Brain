import { DEFAULT_DISCLAIMER, DEFAULT_RANGES, SAFETY_SECTION_ID } from './defaults';
import { questionsRead, sectionsRead } from './rules';
import type { Definition, Issue, Option, PlanRow, Question, Range, Rule, Section, SectionReport, Text } from './types';

// Light validation. Only four things block an import: invalid JSON, no questions, duplicate ids, and a
// rule pointing to an id that does not exist. Everything else is a warning in plain English.

export type ParseResult =
  | { ok: true; definition: Definition; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export function parseDefinition(input: unknown): ParseResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const error = (where: string, message: string) => errors.push({ where, message });
  const warn = (where: string, message: string) => warnings.push({ where, message });

  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [{ where: 'JSON', message: `The text is not valid JSON (${(e as Error).message}).` }], warnings };
    }
  }
  if (!isObject(raw)) return { ok: false, errors: [{ where: 'JSON', message: 'The JSON must be an object with "sections".' }], warnings };

  // --- texts and top-level fields
  const title = text(raw.title, 'title', warn, { required: true });
  const subtitle = raw.subtitle == null ? null : text(raw.subtitle, 'subtitle', warn);
  const closing = raw.closing == null ? null : text(raw.closing, 'closing', warn);
  const disclaimer = raw.disclaimer == null ? DEFAULT_DISCLAIMER : text(raw.disclaimer, 'disclaimer', warn);

  // --- ranges
  let ranges: Range[] = DEFAULT_RANGES;
  if (raw.ranges != null) {
    const list = Array.isArray(raw.ranges) ? raw.ranges : [];
    const parsed = list
      .map((r, i): Range | null => {
        if (!isObject(r) || typeof r.up_to !== 'number' || typeof r.en !== 'string') {
          warn(`ranges, item ${i + 1}`, 'Each range needs "up_to" (a number) and "en". The default ranges are used.');
          return null;
        }
        if (typeof r.hi !== 'string' || !r.hi.trim()) warn(`ranges, item ${i + 1}`, 'No Hindi name; English is used.');
        return { up_to: r.up_to, en: r.en, hi: typeof r.hi === 'string' ? r.hi : null };
      })
      .filter((r): r is Range => r !== null)
      .sort((a, b) => a.up_to - b.up_to);
    if (parsed.length === list.length && parsed.length > 0) {
      if (parsed[parsed.length - 1].up_to < 100) {
        warn('ranges', 'The ranges do not reach 100. The default ranges are used.');
      } else ranges = parsed;
    } else if (list.length === 0) {
      warn('ranges', 'Empty "ranges"; the default ranges are used.');
    }
  }

  // --- plan
  const plan: PlanRow[] = [];
  if (raw.plan != null) {
    const list = Array.isArray(raw.plan) ? raw.plan : [];
    list.forEach((p, i) => {
      const where = `plan, row ${i + 1}`;
      if (!isObject(p) || typeof p.range !== 'number' || typeof p.sessions !== 'number') {
        warn(where, 'Each plan row needs "range" (1 = the first range), "sessions", "name" and "pace". This row is skipped.');
        return;
      }
      if (p.range < 1 || p.range > ranges.length) warn(where, `"range" ${p.range} does not match any of the ${ranges.length} ranges.`);
      plan.push({ range: p.range, sessions: p.sessions, name: text(p.name, `${where}, name`, warn), pace: text(p.pace, `${where}, pace`, warn) });
    });
  } else warn('plan', 'No plan: the report will not suggest a number of sessions.');

  // --- sections and questions
  const sections: Section[] = [];
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();
  const rules: { where: string; rule: Rule; sectionIndex: number; questionIndex: number }[] = [];
  const sectionList = Array.isArray(raw.sections) ? raw.sections : [];
  if (!Array.isArray(raw.sections)) error('sections', 'The JSON needs a "sections" list.');

  sectionList.forEach((s, si) => {
    const where = `Section ${si + 1}`;
    if (!isObject(s)) {
      error(where, 'A section must be an object.');
      return;
    }
    const id = idOf(s.id, where, error);
    if (id) {
      if (sectionIds.has(id)) error(where, `The id "${id}" is used by another section.`);
      if (id === SAFETY_SECTION_ID) error(where, `The id "${SAFETY_SECTION_ID}" is reserved for the built-in safety section.`);
      sectionIds.add(id);
    }
    const questions: Question[] = [];
    const qList = Array.isArray(s.questions) ? s.questions : [];
    if (qList.length === 0) warn(where, 'This section has no questions.');
    qList.forEach((q, qi) => {
      const qWhere = `${where}, question ${qi + 1}`;
      if (!isObject(q)) {
        error(qWhere, 'A question must be an object.');
        return;
      }
      const qid = idOf(q.id, qWhere, error);
      if (qid) {
        if (questionIds.has(qid)) error(qWhere, `The id "${qid}" is used by another question.`);
        questionIds.add(qid);
      }
      const options: Option[] = [];
      const optionIds = new Set<string>();
      const oList = Array.isArray(q.options) ? q.options : [];
      if (oList.length === 0) error(qWhere, 'A question needs at least one option.');
      oList.forEach((o, oi) => {
        const oWhere = `${qWhere}, option ${oi + 1}`;
        if (!isObject(o)) {
          error(oWhere, 'An option must be an object.');
          return;
        }
        const oid = idOf(o.id, oWhere, error);
        if (oid) {
          if (optionIds.has(oid)) error(oWhere, `The id "${oid}" is used by another option of this question.`);
          optionIds.add(oid);
        }
        let value: number | null = null;
        if (o.value === null || o.value === undefined) value = null;
        else if (typeof o.value === 'number' && Number.isFinite(o.value)) value = o.value;
        else if (typeof o.value === 'string' && o.value.trim() !== '' && Number.isFinite(Number(o.value))) value = Number(o.value);
        else error(oWhere, '"value" must be a number or null.');
        options.push({
          id: oid ?? `option_${oi + 1}`,
          text: text(o.text, oWhere, warn),
          value,
          note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null,
        });
      });
      const multiple = q.multiple === true;
      let maxChoices: number | null = null;
      if (q.max_choices != null) {
        if (typeof q.max_choices === 'number' && q.max_choices >= 1) maxChoices = Math.floor(q.max_choices);
        else warn(qWhere, '"max_choices" must be a whole number of 1 or more; it is ignored.');
        if (!multiple) warn(qWhere, '"max_choices" only applies when "multiple" is true.');
      }
      const showWhen = ruleOf(q.show_when, `${qWhere}, show_when`, error);
      if (showWhen) rules.push({ where: `${qWhere}, show_when`, rule: showWhen, sectionIndex: si, questionIndex: qi });
      questions.push({ id: qid ?? `question_${qi + 1}`, text: text(q.text, qWhere, warn), multiple, max_choices: maxChoices, show_when: showWhen, options });
    });

    const scored = s.scored !== false;
    if (scored && questions.length > 0 && questions.every((q) => q.options.every((o) => o.value === null))) {
      warn(where, 'This section is scored but none of its options has a value, so it will never get a score.');
    }
    const showWhen = ruleOf(s.show_when, `${where}, show_when`, error);
    if (showWhen) rules.push({ where: `${where}, show_when`, rule: showWhen, sectionIndex: si, questionIndex: -1 });

    let report: SectionReport | null = null;
    if (s.report != null) {
      const r = isObject(s.report) ? s.report : {};
      const meaning = Array.isArray(r.meaning) ? r.meaning.map((m, i) => text(m, `${where}, report meaning ${i + 1}`, warn)) : [];
      const focus = Array.isArray(r.focus) ? r.focus.map((m, i) => text(m, `${where}, report focus ${i + 1}`, warn)) : [];
      report = { meaning, focus };
      if (scored && meaning.length > 0 && meaning.length < ranges.length) {
        warn(where, `Report has ${meaning.length} meaning line(s) for ${ranges.length} ranges; the missing ranges print no line.`);
      }
    }
    if (scored && (!report || report.meaning.length === 0)) warn(where, 'No report meaning lines: the snapshot shows only the score and range.');
    if (scored && (!report || report.focus.length === 0)) warn(where, 'No focus lines: "What your sessions will work on" is left out when this is the main area.');

    sections.push({ id: id ?? `section_${si + 1}`, title: text(s.title, `${where}, title`, warn, { required: true }), scored, show_when: showWhen, report, questions });
  });

  if (errors.length === 0 && sections.every((s) => s.questions.length === 0)) error('sections', 'The questionnaire has no questions.');

  // --- rule references (errors) and order (warnings)
  const positions = new Map<string, { section: number; question: number }>();
  sections.forEach((s, si) => s.questions.forEach((q, qi) => positions.set(q.id, { section: si, question: qi })));
  const optionsOf = new Map(sections.flatMap((s) => s.questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))] as const)));
  const sectionPos = new Map(sections.map((s, i) => [s.id, i] as const));

  for (const { where, rule, sectionIndex, questionIndex } of rules) {
    for (const qid of questionsRead(rule)) {
      if (!positions.has(qid)) {
        error(where, `The rule points to question "${qid}", which does not exist.`);
        continue;
      }
      const p = positions.get(qid)!;
      const later = p.section > sectionIndex || (p.section === sectionIndex && (questionIndex === -1 || p.question >= questionIndex));
      if (later) warn(where, `The rule reads question "${qid}", which comes later, so it counts as false there.`);
    }
    for (const sid of sectionsRead(rule)) {
      if (!sectionPos.has(sid)) {
        error(where, `The rule points to section "${sid}", which does not exist.`);
        continue;
      }
      if (sectionPos.get(sid)! >= sectionIndex) warn(where, `The rule reads the score of section "${sid}", which is not finished at that point, so it counts as false.`);
      if (!sections[sectionPos.get(sid)!].scored) warn(where, `Section "${sid}" is not scored, so this rule is always false.`);
    }
    for (const [qid, ids] of optionRefs(rule)) {
      const known = optionsOf.get(qid);
      if (!known) continue;
      for (const oid of ids) if (!known.has(oid)) error(where, `Question "${qid}" has no option "${oid}".`);
    }
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, definition: { title, subtitle, closing, disclaimer, ranges, plan, sections }, warnings };
}

// ---------------------------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function idOf(v: unknown, where: string, error: (w: string, m: string) => void): string | null {
  if (typeof v !== 'string' || !v.trim()) {
    error(where, 'Missing "id".');
    return null;
  }
  const id = v.trim();
  if (!ID_RE.test(id)) error(where, `The id "${id}" may only use letters, digits and _ and must start with a letter.`);
  return id;
}

function text(v: unknown, where: string, warn: (w: string, m: string) => void, opts: { required?: boolean } = {}): Text {
  if (typeof v === 'string') {
    warn(where, 'No Hindi text; English is used.');
    return { en: v, hi: null };
  }
  if (!isObject(v) || typeof v.en !== 'string' || !v.en.trim()) {
    if (opts.required) warn(where, 'Missing text ({ "en": "…", "hi": "…" }).');
    return { en: isObject(v) && typeof v.en === 'string' ? v.en : '', hi: isObject(v) && typeof v.hi === 'string' ? v.hi : null };
  }
  const hi = typeof v.hi === 'string' && v.hi.trim() ? v.hi : null;
  if (!hi) warn(where, 'No Hindi text; English is used.');
  return { en: v.en, hi };
}

/** Accepts exactly the documented rule shapes; anything else is an error. */
function ruleOf(v: unknown, where: string, error: (w: string, m: string) => void): Rule | null {
  if (v == null) return null;
  if (!isObject(v)) {
    error(where, 'A rule must be an object.');
    return null;
  }
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
  if (typeof v.question === 'string') {
    if (strings(v.is)) return { question: v.question, is: v.is as string[] };
    if (strings(v.is_not)) return { question: v.question, is_not: v.is_not as string[] };
    if (strings(v.includes)) return { question: v.question, includes: v.includes as string[] };
    error(where, 'A question rule needs "is", "is_not" or "includes" with a list of option ids.');
    return null;
  }
  if (typeof v.section === 'string') {
    if (typeof v.score_at_least === 'number') return { section: v.section, score_at_least: v.score_at_least };
    if (typeof v.score_at_most === 'number') return { section: v.section, score_at_most: v.score_at_most };
    error(where, 'A section rule needs "score_at_least" or "score_at_most" with a number.');
    return null;
  }
  if (Array.isArray(v.all) || Array.isArray(v.any)) {
    const key = Array.isArray(v.all) ? 'all' : 'any';
    const inner = (v[key] as unknown[]).map((r, i) => ruleOf(r, `${where}, ${key} ${i + 1}`, error)).filter((r): r is Rule => r !== null);
    return key === 'all' ? { all: inner } : { any: inner };
  }
  error(where, 'Unknown rule. Use { "question", "is" | "is_not" | "includes" }, { "section", "score_at_least" | "score_at_most" }, { "all": [] } or { "any": [] }.');
  return null;
}

function optionRefs(rule: Rule): [string, string[]][] {
  if ('all' in rule) return rule.all.flatMap(optionRefs);
  if ('any' in rule) return rule.any.flatMap(optionRefs);
  if ('section' in rule) return [];
  return [[rule.question, 'is' in rule ? rule.is : 'is_not' in rule ? rule.is_not : rule.includes]];
}
