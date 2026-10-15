import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { BAND_NAMES } from './conditions';
import type {
  ContentPayload,
  ItemTextTrigger,
  QbItemText,
  QbModule,
  QbOption,
  QbQuestion,
  QbText,
  QbTier,
  QuestionPath,
  QuestionType,
  Scored,
} from './types';

// Parses a question bank workbook into a content payload (no rules). Every quirk of the source files
// is handled here; anything unexpected becomes a readable error and no payload is returned.

export interface KnownTest {
  code: string;
  name_en: string;
}

export interface ParseResult {
  payload: ContentPayload | null;
  errors: string[];
  warnings: string[];
}

type Cell = string | number | boolean | null;

const TABS = {
  readme: 'README',
  questions: 'Questions',
  scoring: 'Scoring Rules',
  tiers: 'Session Tiers',
  reportText: 'Report Text',
  strengths: 'Strengths & Stuck',
  flags: 'Flags & Safety',
  worked: 'Worked Examples',
  progress: 'Progress Assessment',
  changeLog: 'Change Log',
} as const;

const REQUIRED_TABS = [
  TABS.readme, TABS.questions, TABS.tiers, TABS.reportText, TABS.strengths, TABS.flags,
];

const QUESTION_COLUMNS = {
  id: 'ID',
  module: 'Module',
  moduleEn: 'Module name (EN)',
  moduleHi: 'Module name (HI)',
  type: 'Type',
  textEn: 'Question (EN)',
  textHi: 'Question (HI)',
  options: 'Options / Scale (EN || HI)',
  reverse: 'Reverse',
  scored: 'Scored?',
  note: 'Routing / Dev note',
  path: 'Path',
} as const;

const TYPE_MAP: Record<string, QuestionType> = {
  likert: 'likert',
  yn: 'yn',
  single: 'single',
  multi: 'multi',
  // I1 is typed "number" but is an age-band choice.
  number: 'single',
};

const SCORED_MAP: Record<string, Scored> = { yes: 'yes', no: 'no', points: 'points' };
const PATH_MAP: Record<string, QuestionPath> = { all: 'all', partner: 'partner', solo: 'solo' };

const TRIGGER_MAP: Record<string, ItemTextTrigger> = {
  'raw answer = often (3)': 'often',
  'raw answer = often (3) or sometimes (2)': 'often_or_sometimes',
  'raw answer = often (3) or sometimes (2) / yes': 'often_sometimes_or_yes',
};

const VALUE_SUFFIX = /\s*\((\d+)\)\s*$/;
const CODE_PREFIX = /^([A-Z]):\s*/;
const BAND_RANGE = /^(\d+)\s*[–-]\s*(\d+)\s*%$/;

export async function parseWorkbook(
  data: ArrayBuffer | Uint8Array,
  options: { fileName: string; tests: KnownTest[] }
): Promise<ParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs accepts a Node Buffer; its typings lag behind current @types/node.
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return { payload: null, errors: ['The file could not be read as an Excel workbook (.xlsx).'], warnings };
  }

  const sheets = new Map<string, Cell[][]>();
  workbook.eachSheet((ws) => sheets.set(ws.name.trim(), readSheet(ws)));

  for (const tab of REQUIRED_TABS) {
    if (!sheets.has(tab)) errors.push(`Missing tab "${tab}".`);
  }
  if (errors.length) return { payload: null, errors, warnings };

  const tabCounts: Record<string, number> = {};
  for (const [name, rows] of sheets) {
    tabCounts[name] = rows.slice(1).filter((r) => r.some((c) => text(c) !== '')).length;
  }

  // README title → test and version label (never from the file name).
  const title = text(sheets.get(TABS.readme)![0]?.[0]);
  const test = options.tests.find((t) => title.toLowerCase().includes(t.name_en.toLowerCase()));
  const versionMatch = title.match(/\bv(\d+(?:\.\d+)+)\b/i);
  if (!test) {
    errors.push(
      `README title "${title}" does not name a known test (${options.tests.map((t) => t.name_en).join(', ')}).`
    );
  }
  if (!versionMatch) errors.push(`README title "${title}" has no version such as "v1.1".`);

  const { modules, questions, options: opts } = parseQuestions(sheets.get(TABS.questions)!, errors);
  const texts = parseReportTexts(sheets.get(TABS.reportText)!, errors);
  parseFlagTexts(sheets.get(TABS.flags)!, texts, errors);
  const itemTexts = parseItemTexts(sheets.get(TABS.strengths)!, errors);
  const { tiers, bands } = parseTiers(sheets.get(TABS.tiers)!, errors);
  const worked = sheets.has(TABS.worked) ? parseWorkedExamples(sheets.get(TABS.worked)!, errors) : [];
  if (!sheets.has(TABS.worked)) warnings.push(`No "${TABS.worked}" tab: no test cases to cross-check.`);

  if (errors.length || !test || !versionMatch) return { payload: null, errors, warnings };

  return {
    payload: {
      test_code: test.code,
      version_label: versionMatch[1],
      source_file_name: options.fileName,
      source_checksum: createHash('sha256').update(bytes).digest('hex'),
      modules,
      questions,
      options: opts,
      texts,
      item_texts: itemTexts,
      tiers,
      sheet_bands: bands,
      sheet_worked_examples: worked,
      tab_counts: tabCounts,
    },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Tabs

function parseQuestions(rows: Cell[][], errors: string[]) {
  const col = columns(rows[0], Object.values(QUESTION_COLUMNS), TABS.questions, errors, [
    QUESTION_COLUMNS.path,
  ]);
  const modules: Omit<QbModule, 'kind'>[] = [];
  const questions: QbQuestion[] = [];
  const options: QbOption[] = [];
  const seen = new Set<string>();
  if (!col) return { modules, questions, options };

  rows.slice(1).forEach((row, i) => {
    const qid = text(row[col[QUESTION_COLUMNS.id]]);
    if (!qid) return;
    const at = `${TABS.questions} row ${i + 2} (${qid})`;
    if (seen.has(qid)) errors.push(`${at}: duplicate ID.`);
    seen.add(qid);

    const moduleCode = text(row[col[QUESTION_COLUMNS.module]]);
    const moduleEn = text(row[col[QUESTION_COLUMNS.moduleEn]]);
    const moduleHi = text(row[col[QUESTION_COLUMNS.moduleHi]]);
    const existing = modules.find((m) => m.code === moduleCode);
    if (!moduleCode) errors.push(`${at}: Module is empty.`);
    else if (!existing) modules.push({ code: moduleCode, name_en: moduleEn, name_hi: moduleHi, sort: modules.length + 1 });
    else if (existing.name_en !== moduleEn || existing.name_hi !== moduleHi) {
      errors.push(`${at}: module ${moduleCode} has a different name than on earlier rows.`);
    }

    const rawType = text(row[col[QUESTION_COLUMNS.type]]).toLowerCase();
    const type = TYPE_MAP[rawType];
    if (!type) errors.push(`${at}: unknown Type "${rawType}".`);

    const reverse = parseBool(row[col[QUESTION_COLUMNS.reverse]]);
    if (reverse === null) errors.push(`${at}: Reverse must be TRUE or FALSE.`);

    const rawScored = text(row[col[QUESTION_COLUMNS.scored]]).toLowerCase();
    const scored = SCORED_MAP[rawScored];
    if (!scored) errors.push(`${at}: Scored? must be Yes, No or Points (got "${rawScored}").`);

    let path: QuestionPath = 'all';
    if (col[QUESTION_COLUMNS.path] !== undefined) {
      const rawPath = text(row[col[QUESTION_COLUMNS.path]]).toLowerCase();
      const mapped = PATH_MAP[rawPath];
      if (!mapped) errors.push(`${at}: Path must be ALL, PARTNER or SOLO (got "${rawPath}").`);
      else path = mapped;
    }

    const textEn = text(row[col[QUESTION_COLUMNS.textEn]]);
    const textHi = text(row[col[QUESTION_COLUMNS.textHi]]);
    if (!textEn) errors.push(`${at}: Question (EN) is empty.`);
    if (!textHi) errors.push(`${at}: Question (HI) is empty.`);

    const note = text(row[col[QUESTION_COLUMNS.note]]);
    questions.push({
      qid,
      module_code: moduleCode,
      type: type ?? 'single',
      text_en: textEn,
      text_hi: textHi,
      reverse: reverse ?? false,
      scored: scored ?? 'no',
      path,
      sort: questions.length + 1,
      is_protected: false,
      source_note: note || null,
    });

    options.push(...parseOptions(qid, text(row[col[QUESTION_COLUMNS.options]]), at, errors));
  });

  return { modules, questions, options };
}

/** `EN options || HI options`; ` | ` between options, ` / ` only when there is no ` | ` (I1, MI1). */
export function parseOptions(qid: string, raw: string, at: string, errors: string[]): QbOption[] {
  const parts = raw.split('||');
  if (parts.length !== 2) {
    errors.push(`${at}: options must be "EN options || HI options".`);
    return [];
  }
  const [enRaw, hiRaw] = parts.map((p) => p.trim());
  const separator = enRaw.includes(' | ') ? ' | ' : enRaw.includes(' / ') ? ' / ' : null;
  const en = separator ? enRaw.split(separator).map((s) => s.trim()) : [enRaw];
  const hi = separator ? hiRaw.split(separator).map((s) => s.trim()) : [hiRaw];
  if (en.length !== hi.length) {
    errors.push(`${at}: ${en.length} EN options but ${hi.length} HI options.`);
    return [];
  }

  // Gate options carry a letter code ("A: Fights…") on every option, in both languages.
  const lettered = en.every((label) => CODE_PREFIX.test(label));

  const result: QbOption[] = [];
  en.forEach((enLabel, i) => {
    let labelEn = enLabel;
    let labelHi = hi[i];
    let code: string;

    if (lettered) {
      const enCode = labelEn.match(CODE_PREFIX)![1];
      const hiCode = labelHi.match(CODE_PREFIX)?.[1];
      if (hiCode !== enCode) errors.push(`${at}: option ${enCode} has no matching "${enCode}:" in HI.`);
      labelEn = labelEn.replace(CODE_PREFIX, '');
      labelHi = labelHi.replace(CODE_PREFIX, '');
      code = enCode;
    } else {
      code = '';
    }

    // Scores embedded in labels: "Never(0)", "Less than 3 months (0)".
    const enValue = labelEn.match(VALUE_SUFFIX);
    const hiValue = labelHi.match(VALUE_SUFFIX);
    const value = enValue ? Number(enValue[1]) : null;
    if (hiValue && Number(hiValue[1]) !== value) {
      errors.push(`${at}: option "${labelEn}" has value ${value} in EN but ${hiValue[1]} in HI.`);
    }
    labelEn = labelEn.replace(VALUE_SUFFIX, '').trim();
    labelHi = labelHi.replace(VALUE_SUFFIX, '').trim();
    if (!lettered) code = slug(labelEn);

    if (!labelEn || !labelHi) errors.push(`${at}: option ${i + 1} has an empty EN or HI label.`);
    if (!code) errors.push(`${at}: option "${labelEn}" gives an empty option code.`);
    if (result.some((o) => o.option_code === code)) errors.push(`${at}: duplicate option code "${code}".`);

    result.push({ qid, option_code: code, label_en: labelEn, label_hi: labelHi, value, sort: i + 1 });
  });
  return result;
}

function parseReportTexts(rows: Cell[][], errors: string[]): QbText[] {
  const col = columns(rows[0], ['Key', 'Module', 'Band', 'Text (EN)', 'Text (HI)'], TABS.reportText, errors);
  const texts: QbText[] = [];
  if (!col) return texts;
  rows.slice(1).forEach((row, i) => {
    const key = text(row[col['Key']]);
    if (!key) return;
    const at = `${TABS.reportText} row ${i + 2} (${key})`;
    const band = text(row[col['Band']]) || null;
    if (band && !(BAND_NAMES as readonly string[]).includes(band)) errors.push(`${at}: unknown Band "${band}".`);
    pushText(texts, {
      key,
      module_code: text(row[col['Module']]) || null,
      band,
      text_en: text(row[col['Text (EN)']]),
      text_hi: text(row[col['Text (HI)']]),
    }, at, errors);
  });
  return texts;
}

/** Flags & Safety texts are stored with the report texts, key = flag name. */
function parseFlagTexts(rows: Cell[][], texts: QbText[], errors: string[]) {
  const col = columns(rows[0], ['Flag', 'Text (EN)', 'Text (HI)'], TABS.flags, errors);
  if (!col) return;
  rows.slice(1).forEach((row, i) => {
    const key = text(row[col['Flag']]);
    if (!key) return;
    pushText(texts, {
      key,
      module_code: null,
      band: null,
      text_en: text(row[col['Text (EN)']]),
      text_hi: text(row[col['Text (HI)']]),
    }, `${TABS.flags} row ${i + 2} (${key})`, errors);
  });
}

function pushText(texts: QbText[], t: QbText, at: string, errors: string[]) {
  if (texts.some((x) => x.key === t.key)) errors.push(`${at}: duplicate text key.`);
  if (!t.text_en) errors.push(`${at}: Text (EN) is empty.`);
  if (!t.text_hi) errors.push(`${at}: Text (HI) is empty.`);
  texts.push(t);
}

function parseItemTexts(rows: Cell[][], errors: string[]): QbItemText[] {
  const col = columns(rows[0], ['Item ID', 'Kind', 'Trigger', 'Text (EN)', 'Text (HI)'], TABS.strengths, errors);
  const items: QbItemText[] = [];
  if (!col) return items;
  rows.slice(1).forEach((row, i) => {
    const qid = text(row[col['Item ID']]);
    if (!qid) return;
    const at = `${TABS.strengths} row ${i + 2} (${qid})`;
    const rawKind = text(row[col['Kind']]).toLowerCase();
    const kind = rawKind === 'strength' || rawKind === 'stuck' ? rawKind : null;
    if (!kind) errors.push(`${at}: Kind must be STRENGTH or STUCK.`);
    const rawTrigger = text(row[col['Trigger']]);
    const trigger = TRIGGER_MAP[rawTrigger.toLowerCase().replace(/\s+/g, ' ')];
    if (!trigger) errors.push(`${at}: unknown Trigger "${rawTrigger}".`);
    if (items.some((x) => x.qid === qid && x.kind === kind)) errors.push(`${at}: duplicate ${rawKind} text.`);
    const textEn = text(row[col['Text (EN)']]);
    const textHi = text(row[col['Text (HI)']]);
    if (!textEn || !textHi) errors.push(`${at}: Text (EN) and Text (HI) are both required.`);
    items.push({ qid, kind: kind ?? 'stuck', trigger: trigger ?? 'often', text_en: textEn, text_hi: textHi });
  });
  return items;
}

function parseTiers(rows: Cell[][], errors: string[]) {
  const header = ['Sessions', 'Plan name (EN)', 'Plan name (HI)', 'Pace (EN)', 'Pace (HI)', 'Typical case'];
  const col = columns(rows[0], header, TABS.tiers, errors);
  const tiers: QbTier[] = [];
  const bands: ContentPayload['sheet_bands'] = [];
  if (!col) return { tiers, bands };
  rows.slice(1).forEach((row, i) => {
    const first = row[col['Sessions']];
    const at = `${TABS.tiers} row ${i + 2}`;
    if (typeof first === 'number') {
      const tier = {
        sessions: first,
        plan_en: text(row[col['Plan name (EN)']]),
        plan_hi: text(row[col['Plan name (HI)']]),
        pace_en: text(row[col['Pace (EN)']]),
        pace_hi: text(row[col['Pace (HI)']]),
        typical_case: text(row[col['Typical case']]) || null,
      };
      if (!tier.plan_en || !tier.plan_hi || !tier.pace_en || !tier.pace_hi) {
        errors.push(`${at}: plan and pace need EN and HI.`);
      }
      tiers.push(tier);
      return;
    }
    // Band rows below the tiers: "0–25%" | Low | कम
    const range = text(first).match(BAND_RANGE);
    if (range) {
      bands.push({
        min: Number(range[1]),
        max: Number(range[2]),
        name_en: text(row[1]),
        name_hi: text(row[2]),
      });
    }
  });
  if (tiers.length === 0) errors.push(`${TABS.tiers}: no session tiers found.`);
  if (bands.length !== 4) errors.push(`${TABS.tiers}: expected 4 band rows, found ${bands.length}.`);
  return { tiers, bands };
}

function parseWorkedExamples(rows: Cell[][], errors: string[]) {
  const col = columns(rows[0], ['Case', 'Profile', 'Expected tier', 'Format'], TABS.worked, errors);
  const cases: ContentPayload['sheet_worked_examples'] = [];
  if (!col) return cases;
  rows.slice(1).forEach((row) => {
    const name = text(row[col['Case']]);
    const tier = row[col['Expected tier']];
    // Only case rows (A, B, …) have a literal expected tier; the note row does not.
    if (!/^[A-Z]$/.test(name) || typeof tier !== 'number') return;
    cases.push({ case: name, profile: text(row[col['Profile']]), expected_tier: tier, format: text(row[col['Format']]) });
  });
  return cases;
}

// ---------------------------------------------------------------------------------------------
// Helpers

function readSheet(ws: ExcelJS.Worksheet): Cell[][] {
  const rows: Cell[][] = [];
  const width = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Cell[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellValue(row.getCell(c).value));
    rows.push(cells);
  }
  return rows;
}

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    // Formulas: use the cached result; Worked Examples formulas have none.
    if ('formula' in value || 'sharedFormula' in value) {
      const result = (value as { result?: unknown }).result;
      return typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' ? result : null;
    }
    if ('text' in value) return String((value as { text: unknown }).text);
    if ('error' in value) return null;
  }
  return String(value);
}

function text(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).replace(/\r\n?/g, '\n').trim();
}

/** Reverse column mixes TRUE / True / FALSE / False strings and real booleans. */
function parseBool(cell: Cell | undefined): boolean | null {
  if (typeof cell === 'boolean') return cell;
  const t = text(cell).toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  return null;
}

/** Stable option code: snake_case of the English label ("18–24" → "18_24", "55+" → "55_plus"). */
export function slug(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, ' plus')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function columns(
  header: Cell[] | undefined,
  names: readonly string[],
  tab: string,
  errors: string[],
  optional: readonly string[] = []
): Record<string, number> | null {
  const map: Record<string, number> = {};
  const cells = (header ?? []).map((c) => text(c));
  let ok = true;
  for (const name of names) {
    const index = cells.indexOf(name);
    if (index >= 0) map[name] = index;
    else if (!optional.includes(name)) {
      errors.push(`${tab}: missing column "${name}".`);
      ok = false;
    }
  }
  return ok ? map : null;
}
