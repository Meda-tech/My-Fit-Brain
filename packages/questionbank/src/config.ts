import type { ImportPayload, QbTest, QbVersion, VersionConfig, VersionStatus } from './types';

// Builds the same VersionConfig the loader returns from the database, but from an import payload
// (workbook + rules, optionally patched). Used by offline tests and, later, by editor previews.

export function configFromPayload(
  payload: ImportPayload,
  options: { versionId?: string; status?: VersionStatus; test?: Partial<QbTest> } = {}
): VersionConfig {
  const version: QbVersion = {
    id: options.versionId ?? `offline-${payload.test_code}-${payload.version_label}`,
    test_code: payload.test_code,
    version_label: payload.version_label,
    status: options.status ?? 'draft',
    based_on_version_id: null,
    change_note: payload.change_note,
    source_file_name: payload.source_file_name,
    source_checksum: payload.source_checksum,
    created_by: null,
    submitted_by: null,
    submitted_at: null,
    approved_by: null,
    approved_at: null,
    published_at: null,
    retired_at: null,
    created_at: '1970-01-01T00:00:00.000Z',
    updated_at: '1970-01-01T00:00:00.000Z',
  };
  const test: QbTest = {
    code: payload.test_code,
    name_en: options.test?.name_en ?? payload.test_code,
    name_hi: options.test?.name_hi ?? null,
    report_id_prefix: options.test?.report_id_prefix ?? `MFB-${payload.test_code}`,
    sort: options.test?.sort ?? 0,
  };
  const bySort = <T extends { sort: number }>(rows: T[]) => [...rows].sort((a, b) => a.sort - b.sort);
  return {
    version,
    test,
    modules: bySort(payload.modules),
    questions: bySort(payload.questions).map((q) => ({
      ...q,
      options: bySort(payload.options.filter((o) => o.qid === q.qid)),
    })),
    texts: payload.texts,
    item_texts: payload.item_texts,
    tiers: [...payload.tiers].sort((a, b) => a.sessions - b.sessions),
    scoring: payload.scoring,
    point_rules: bySort(payload.point_rules),
    overrides: bySort(payload.overrides),
    visibility_rules: payload.visibility_rules,
    option_rules: bySort(payload.option_rules),
    flags: bySort(payload.flags),
    format_rules: bySort(payload.format_rules),
    report_rules: payload.report_rules,
  };
}
