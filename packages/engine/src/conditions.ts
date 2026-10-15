import type { BandName, Condition } from '@mfb/questionbank';
import { ConfigError } from './errors';
import type { Facts } from './facts';

// Evaluates one condition (docs/questionbank/rules-reference.md) against facts.
// Three-valued: a fact that is not knowable yet (an unanswered question while answering, a band before
// its module is complete) gives 'unknown'. Callers decide: visibility treats unknown as false, flags
// wait until everything is known. An unknown fact or operator throws: the configuration is wrong.

export type TriState = boolean | 'unknown';

export function evaluateCondition(cond: Condition, facts: Facts): TriState {
  if (!cond || typeof cond !== 'object') throw new ConfigError(`condition is not an object: ${JSON.stringify(cond)}`);

  if ('all' in cond) {
    let result: TriState = true;
    for (const c of cond.all) {
      const r = evaluateCondition(c, facts);
      if (r === false) return false;
      if (r === 'unknown') result = 'unknown';
    }
    return result;
  }
  if ('any' in cond) {
    let result: TriState = false;
    for (const c of cond.any) {
      const r = evaluateCondition(c, facts);
      if (r === true) return true;
      if (r === 'unknown') result = 'unknown';
    }
    return result;
  }
  if ('not' in cond) {
    const r = evaluateCondition(cond.not, facts);
    return r === 'unknown' ? 'unknown' : !r;
  }

  switch (cond.fact) {
    case 'answer': {
      const selected = selectedCodes(facts, cond.q);
      if (selected === 'unknown') return 'unknown';
      const values = list(cond.value);
      const hit = selected.some((code) => values.includes(code));
      switch (cond.op) {
        case 'eq':
        case 'in':
          return hit;
        case 'neq':
        case 'not_in':
          return !hit;
        default:
          return badOperator(cond);
      }
    }
    case 'answer_value': {
      const question = facts.index.question(cond.q);
      if (question.type === 'multi') throw new ConfigError(`answer_value cannot be used on multi-select question ${cond.q}`);
      const selected = selectedCodes(facts, cond.q);
      if (selected === 'unknown') return 'unknown';
      if (selected.length === 0) return false;
      const value = question.options.find((o) => o.option_code === selected[0])?.value;
      if (value === null || value === undefined) return false;
      return compareNumber(value, cond.op, cond.value, cond);
    }
    case 'answered_any_except': {
      const selected = selectedCodes(facts, cond.q);
      if (selected === 'unknown') return 'unknown';
      return selected.some((code) => !cond.value.includes(code));
    }
    case 'sex': {
      if (facts.sex === null) return false;
      return opMatch(facts.sex, cond.op, cond.value, cond);
    }
    case 'age':
      return compareNumber(facts.age, cond.op, cond.value, cond);
    case 'age_band': {
      if (facts.ageBand === null) return false;
      return opMatch(facts.ageBand, cond.op, cond.value, cond);
    }
    case 'path': {
      if (facts.path === undefined) return 'unknown';
      if (facts.path === null) return false;
      if (cond.op !== 'eq') return badOperator(cond);
      return facts.path === cond.value;
    }
    case 'module_chosen': {
      facts.index.module(cond.value);
      if (facts.chosen === undefined) return 'unknown';
      return facts.chosen.includes(cond.value);
    }
    case 'chosen_count': {
      if (facts.chosen === undefined) return 'unknown';
      return compareNumber(facts.chosen.length, cond.op, cond.value, cond);
    }
    case 'chosen_kinds': {
      if (facts.chosen === undefined) return 'unknown';
      const kinds = facts.chosen.map((m) => facts.index.module(m).kind);
      switch (cond.op) {
        case 'only':
          return kinds.length > 0 && kinds.every((k) => (cond.value as string[]).includes(k));
        case 'includes':
          return cond.value.every((k) => kinds.includes(k));
        default:
          return badOperator(cond);
      }
    }
    case 'band': {
      if (!facts.bandsReady) return 'unknown';
      const band = bandOf(facts, cond.module);
      if (band === 'unknown') return 'unknown';
      if (band === null) return false;
      return compareBand(facts, band, cond.op, cond.value, cond);
    }
    case 'all_bands': {
      if (!facts.bandsReady) return 'unknown';
      const modules = scopeModules(facts, cond.scope);
      if (modules === 'unknown') return 'unknown';
      let result: TriState = true;
      for (const m of modules) {
        const band = facts.bands.get(m);
        if (band === undefined || band === 'unknown') {
          result = 'unknown';
          continue;
        }
        if (band === null || !compareBand(facts, band, cond.op, cond.value, cond)) return false;
      }
      return result;
    }
    case 'count_bands': {
      if (!facts.bandsReady) return 'unknown';
      const modules = scopeModules(facts, cond.scope);
      if (modules === 'unknown') return 'unknown';
      let count = 0;
      let unknown = 0;
      for (const m of modules) {
        const band = facts.bands.get(m);
        if (band === undefined || band === 'unknown') unknown++;
        else if (band !== null && compareBand(facts, band, 'gte', cond.value, cond)) count++;
      }
      if (cond.op !== 'gte') return badOperator(cond);
      if (count >= cond.count) return true;
      return count + unknown >= cond.count ? 'unknown' : false;
    }
    case 'flag': {
      if (!facts.flagsReady) return 'unknown';
      const state = facts.flags.get(cond.key);
      if (state === undefined) {
        throw new ConfigError(`condition refers to flag ${cond.key}, which does not exist or comes later in sort order`);
      }
      return state;
    }
    default:
      throw new ConfigError(`unknown condition fact in ${JSON.stringify(cond)}`);
  }
}

/** True only when the condition is known and true (visibility, option rules). */
export function isTrue(r: TriState): boolean {
  return r === true;
}

// ---------------------------------------------------------------------------------------------

function selectedCodes(facts: Facts, qid: string): string[] | 'unknown' {
  facts.index.question(qid);
  const answer = facts.answers[qid];
  if (answer === undefined || (Array.isArray(answer) && answer.length === 0)) {
    return facts.complete ? [] : 'unknown';
  }
  return Array.isArray(answer) ? answer : [answer];
}

function list(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function opMatch(actual: string, op: string, value: string | string[], cond: Condition): boolean {
  switch (op) {
    case 'eq':
    case 'in':
      return list(value).includes(actual);
    default:
      return badOperator(cond);
  }
}

function compareNumber(actual: number, op: string, value: number, cond: Condition): boolean {
  switch (op) {
    case 'eq':
      return actual === value;
    case 'gte':
      return actual >= value;
    case 'lte':
      return actual <= value;
    case 'gt':
      return actual > value;
    case 'lt':
      return actual < value;
    default:
      return badOperator(cond);
  }
}

function compareBand(facts: Facts, band: BandName, op: string, value: BandName, cond: Condition): boolean {
  const a = facts.index.bandRank(band);
  const b = facts.index.bandRank(value);
  switch (op) {
    case 'eq':
      return a === b;
    case 'gte':
      return a >= b;
    case 'lte':
      return a <= b;
    default:
      return badOperator(cond);
  }
}

function bandOf(facts: Facts, module: string): BandName | null | 'unknown' {
  let code: string | null | undefined;
  if (module === 'primary') code = facts.primary;
  else if (module === 'second') code = facts.second;
  else if (module === 'core') code = facts.coreModule;
  else {
    facts.index.module(module);
    code = module;
  }
  if (code === undefined) return 'unknown';
  if (code === null) return null;
  const band = facts.bands.get(code);
  if (band === undefined) {
    // Not the core and not chosen: no % for this module.
    return facts.chosen === undefined || facts.coreModule === undefined ? 'unknown' : null;
  }
  return band;
}

function scopeModules(facts: Facts, scope: 'core_and_chosen' | 'chosen'): string[] | 'unknown' {
  if (facts.chosen === undefined) return 'unknown';
  if (scope === 'chosen') return facts.chosen;
  if (facts.coreModule === undefined) return 'unknown';
  return [facts.coreModule, ...facts.chosen];
}

function badOperator(cond: Condition): never {
  throw new ConfigError(`unknown operator in ${JSON.stringify(cond)}`);
}
