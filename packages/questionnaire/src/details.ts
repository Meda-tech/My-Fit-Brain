import type { ClientDetail, Issue, Text } from './types';

// Client details: questions after the safety questions where the client types the answer. They are not
// part of scoring, rules or the report. The list lives on the questionnaire (not on a version), so the
// admin can change it at any time; each stored answer keeps the question text as it was asked.

/** The longest answer a client can type (characters). */
export const DETAIL_MAX_LENGTH = 1000;

/** The section title the client sees above these questions. */
export const CLIENT_DETAILS_TITLE: Text = { en: 'A few details about you', hi: 'आपके बारे में कुछ जानकारी' };

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export type DetailsResult = { ok: true; details: ClientDetail[]; warnings: Issue[] } | { ok: false; errors: Issue[]; warnings: Issue[] };

/**
 * Reads a client-details list (from the JSON's "client_details" or from the admin editor). Blocks only
 * a list that is not a list, a missing id or English text, and duplicate ids. Missing Hindi is a warning.
 */
export function parseClientDetails(input: unknown, label = 'client_details'): DetailsResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!Array.isArray(input)) return { ok: false, errors: [{ where: label, message: 'Client details must be a list.' }], warnings };
  const ids = new Set<string>();
  const details: ClientDetail[] = [];
  input.forEach((d, i) => {
    const where = `${label}, question ${i + 1}`;
    const item = typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
    if (!item) {
      errors.push({ where, message: 'A question must be an object with "id" and "text".' });
      return;
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) errors.push({ where, message: 'Missing "id".' });
    else if (!ID_RE.test(id)) errors.push({ where, message: `The id "${id}" may only use letters, digits and _ and must start with a letter.` });
    else if (ids.has(id)) errors.push({ where, message: `The id "${id}" is used by another question.` });
    ids.add(id);

    const t = item.text;
    const en = typeof t === 'string' ? t.trim() : typeof t === 'object' && t !== null && typeof (t as Text).en === 'string' ? (t as Text).en.trim() : '';
    const hiRaw = typeof t === 'object' && t !== null ? (t as Text).hi : null;
    const hi = typeof hiRaw === 'string' && hiRaw.trim() ? hiRaw.trim() : null;
    if (!en) errors.push({ where, message: 'The question needs English text.' });
    else if (!hi) warnings.push({ where, message: 'No Hindi text; English is used.' });
    details.push({ id, text: { en, hi } });
  });
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, details, warnings };
}

/** Checks one typed answer: required, trimmed, at most DETAIL_MAX_LENGTH characters, no control characters. */
export function checkDetailAnswer(input: unknown): { ok: true; answer: string } | { ok: false; message: string } {
  if (typeof input !== 'string') return { ok: false, message: 'Type your answer.' };
  // Keep line breaks and tabs; drop every other control character.
  // eslint-disable-next-line no-control-regex
  const answer = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim();
  if (!answer) return { ok: false, message: 'Type your answer.' };
  if (answer.length > DETAIL_MAX_LENGTH) return { ok: false, message: `Keep the answer under ${DETAIL_MAX_LENGTH} characters.` };
  return { ok: true, answer };
}
