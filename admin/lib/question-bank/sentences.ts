import type {
  Condition,
  Flag,
  FormatRule,
  OptionRule,
  Override,
  PointRule,
  VersionConfig,
  VisibilityRule,
} from '@mfb/questionbank';

// Turns rule JSON into readable sentences for the read-only Rules tab. Generic grammar only: every
// question, option, module and number comes from the version's own data.

export interface Labels {
  question(qid: string): string;
  option(qid: string, code: string): string;
  module(code: string): string;
}

export function labelsFor(config: VersionConfig): Labels {
  const questions = new Map(config.questions.map((q) => [q.qid, q]));
  const modules = new Map(config.modules.map((m) => [m.code, m]));
  return {
    question: (qid) => qid,
    option: (qid, code) => {
      const label = questions.get(qid)?.options.find((o) => o.option_code === code)?.label_en;
      return label ? `“${label}”` : code;
    },
    module: (code) => {
      const m = modules.get(code);
      return m ? `${code} (${m.name_en})` : code;
    },
  };
}

const OP_WORDS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
};

const MODULE_ROLES: Record<string, string> = {
  primary: 'the primary module',
  second: 'the second chosen module',
  core: 'the core',
};

const FORMAT_WORDS: Record<string, string> = {
  individual: 'Individual',
  couple: 'Couple',
  mixed: 'Mixed (individual + couple)',
  individual_partner_joins: 'Individual, partner joins 1–2 sessions',
};

export function formatName(format: string): string {
  return FORMAT_WORDS[format] ?? format;
}

function list(values: string[], word = 'or'): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} ${word} ${values[values.length - 1]}`;
}

function values(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}

export function describeCondition(c: Condition | null | undefined, l: Labels, nested = false): string {
  if (!c) return 'always';
  if ('all' in c) {
    if (c.all.length === 0) return 'always';
    const text = c.all.map((x) => describeCondition(x, l, true)).join(' and ');
    return nested && c.all.length > 1 ? `(${text})` : text;
  }
  if ('any' in c) {
    const text = c.any.map((x) => describeCondition(x, l, true)).join(' or ');
    return nested && c.any.length > 1 ? `(${text})` : text;
  }
  if ('not' in c) return `not ${describeCondition(c.not, l, true)}`;

  switch (c.fact) {
    case 'answer': {
      const opts = values(c.value).map((v) => l.option(c.q, v));
      return `${l.question(c.q)} ${OP_WORDS[c.op]} ${list(opts)}`;
    }
    case 'answer_value':
      return `${l.question(c.q)} answer value ${OP_WORDS[c.op]} ${c.value}`;
    case 'answered_any_except':
      return `${l.question(c.q)} has any answer except ${list(c.value.map((v) => l.option(c.q, v)))}`;
    case 'sex':
      return `sex ${OP_WORDS[c.op]} ${list(values(c.value))}`;
    case 'age':
      return `exact age ${OP_WORDS[c.op]} ${c.value}`;
    case 'age_band':
      return `age band ${OP_WORDS[c.op]} ${list(values(c.value))}`;
    case 'path':
      return `path is ${c.value}`;
    case 'module_chosen':
      return `module ${l.module(c.value)} is chosen`;
    case 'chosen_count':
      return `number of chosen modules ${OP_WORDS[c.op]} ${c.value}`;
    case 'chosen_kinds':
      return c.op === 'only'
        ? `every chosen module is a ${list(c.value)} module`
        : `the chosen modules include ${list(c.value, 'and')} modules`;
    case 'band': {
      const target = MODULE_ROLES[c.module] ?? `module ${l.module(c.module)}`;
      const op = c.op === 'eq' ? 'is' : c.op === 'gte' ? 'is at least' : 'is at most';
      return `the band of ${target} ${op} ${c.value}`;
    }
    case 'all_bands':
      return `every band (${c.scope === 'core_and_chosen' ? 'core and chosen modules' : 'chosen modules'}) is ${c.op === 'lte' ? 'at most' : 'at least'} ${c.value}`;
    case 'count_bands':
      return `at least ${c.count} chosen module${c.count === 1 ? ' is' : 's are'} ${c.value} or higher`;
    case 'flag':
      return `flag ${c.key} is raised`;
    default:
      return JSON.stringify(c);
  }
}

export function describePointRule(r: PointRule, l: Labels): string {
  if (r.source === 'primary_band_severity') return 'Points = severity points of the primary module’s band.';
  if (r.source === 'answer_value') {
    return `Points = answer value of ${r.qid}${r.condition ? `, when ${describeCondition(r.condition, l)}` : ''}.`;
  }
  return `+${r.points} point${r.points === 1 ? '' : 's'} when ${describeCondition(r.condition, l)}.`;
}

export function describeOverride(r: Override, l: Labels): string {
  const action = r.action === 'cap' ? `Cap the tier at ${r.sessions} sessions` : `Raise the tier to at least ${r.sessions} sessions`;
  return `${action} when ${describeCondition(r.condition, l)}.`;
}

export function describeVisibility(r: VisibilityRule, l: Labels): string {
  return `Show ${r.qid} only when ${describeCondition(r.condition, l)}.`;
}

export function describeOptionRule(r: OptionRule, l: Labels): string {
  const option = `${l.option(r.qid, r.option_code)} (${r.option_code})`;
  const action = r.kind === 'hide' ? `Hide option ${option} of ${r.qid}` : `List option ${option} of ${r.qid} first`;
  return `${action} when ${describeCondition(r.condition, l)}.`;
}

export function describeFlagEffects(f: Flag): string[] {
  const e = f.effects;
  const out: string[] = [];
  if (e.stop) out.push(`stop the assessment and show the ${f.key} screen`);
  if (e.interrupt) out.push(`show the ${f.key} support screen immediately, then continue`);
  if (e.layout === 'crisis') out.push('use the crisis report layout');
  if (e.report_block) out.push(`print report block ${e.report_block}`);
  if (e.force_format) out.push(`force the format to ${formatName(e.force_format)}`);
  if (e.notify?.length) out.push(`notify the ${list(e.notify, 'and')}`);
  if (e.dashboard_tag) out.push(`tag ${e.dashboard_tag} on the counsellor dashboard`);
  if (e.printed === false) out.push('never printed in the report');
  return out;
}

export function describeFlag(f: Flag, l: Labels): string {
  return `Raise ${f.key} when ${describeCondition(f.condition, l)}.`;
}

export function describeFormatRule(r: FormatRule, l: Labels): string {
  let text = `${formatName(r.format)} when ${describeCondition(r.condition, l)}`;
  if (r.split) {
    text += `; split ${Object.entries(r.split)
      .map(([sessions, [ind, couple]]) => `${sessions} = ${ind} individual + ${couple} couple`)
      .join(' · ')}`;
  }
  if (r.add_text_key) text += `; add ${r.add_text_key}`;
  return `${text}.`;
}
