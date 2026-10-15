import type { SupabaseClient } from '@supabase/supabase-js';
import type { LatestVersionRules } from './attach-rules';
import type {
  Flag,
  FormatRule,
  OptionRule,
  Override,
  PointRule,
  ReportRules,
  Scoring,
  TestCase,
  VisibilityRule,
} from './rules';
import type {
  QbItemText,
  QbModule,
  QbOption,
  QbQuestion,
  QbTest,
  QbText,
  QbTier,
  QbVersion,
  VersionConfig,
} from './types';

// Loads question bank versions from the database. Rules, texts and test cases are staff-only (RLS),
// so getVersionConfig needs a staff session or the service role.

type Client = SupabaseClient;

const cache = new Map<string, VersionConfig>();

/** The live version of a test, or null. Never cached: publishing changes it. */
export async function getLiveVersionId(supabase: Client, testCode: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('qb_versions')
    .select('id')
    .eq('test_code', testCode)
    .eq('status', 'live')
    .maybeSingle();
  if (error) throw new Error(`Could not read the live ${testCode} version: ${error.message}`);
  return data?.id ?? null;
}

/** Full configuration of one version. Live and retired versions are frozen, so they are cached. */
export async function getVersionConfig(supabase: Client, versionId: string): Promise<VersionConfig> {
  const cached = cache.get(versionId);
  if (cached) return cached;

  const { data: version, error } = await supabase.from('qb_versions').select('*').eq('id', versionId).maybeSingle();
  if (error) throw new Error(`Could not read version ${versionId}: ${error.message}`);
  if (!version) throw new Error(`Version ${versionId} not found.`);

  const v = version as QbVersion;
  const [test, modules, questions, options, texts, itemTexts, tiers, rules] = await Promise.all([
    one<QbTest>(supabase.from('qb_tests').select('*').eq('code', v.test_code).maybeSingle(), 'qb_tests'),
    rows<QbModule>(supabase.from('qb_modules').select('code, name_en, name_hi, kind, sort').eq('version_id', versionId).order('sort'), 'qb_modules'),
    rows<QbQuestion>(
      supabase
        .from('qb_questions')
        .select('qid, module_code, type, text_en, text_hi, reverse, scored, path, sort, is_protected, source_note')
        .eq('version_id', versionId)
        .order('sort'),
      'qb_questions'
    ),
    rows<QbOption>(
      supabase.from('qb_options').select('qid, option_code, label_en, label_hi, value, sort').eq('version_id', versionId).order('sort'),
      'qb_options'
    ),
    rows<QbText>(supabase.from('qb_texts').select('key, module_code, band, text_en, text_hi').eq('version_id', versionId), 'qb_texts'),
    rows<QbItemText>(
      supabase.from('qb_item_texts').select('qid, kind, trigger, text_en, text_hi').eq('version_id', versionId),
      'qb_item_texts'
    ),
    rows<QbTier>(
      supabase.from('qb_tiers').select('sessions, plan_en, plan_hi, pace_en, pace_hi, typical_case').eq('version_id', versionId).order('sessions'),
      'qb_tiers'
    ),
    loadRules(supabase, versionId),
  ]);
  if (!test) throw new Error(`Test ${v.test_code} not found.`);

  const config: VersionConfig = {
    version: v,
    test,
    modules,
    questions: questions.map((q) => ({ ...q, options: options.filter((o) => o.qid === q.qid) })),
    texts,
    item_texts: itemTexts,
    tiers,
    ...rules,
  };

  if (v.status === 'live' || v.status === 'retired') cache.set(versionId, config);
  return config;
}

/** Rules, module kinds, protected questions and test cases of the latest version of a test. */
export async function loadLatestRules(supabase: Client, testCode: string): Promise<LatestVersionRules | null> {
  const { data, error } = await supabase
    .from('qb_versions')
    .select('id, version_label, status, created_at')
    .eq('test_code', testCode)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read ${testCode} versions: ${error.message}`);
  const versions = (data ?? []) as Pick<QbVersion, 'id' | 'version_label' | 'status'>[];
  const latest = versions.find((x) => x.status === 'live') ?? versions[0];
  if (!latest) return null;

  const [rules, modules, protectedRows, testCases] = await Promise.all([
    loadRules(supabase, latest.id),
    rows<Pick<QbModule, 'code' | 'kind'>>(supabase.from('qb_modules').select('code, kind').eq('version_id', latest.id), 'qb_modules'),
    rows<{ qid: string }>(
      supabase.from('qb_questions').select('qid').eq('version_id', latest.id).eq('is_protected', true),
      'qb_questions'
    ),
    rows<TestCase>(
      supabase.from('qb_test_cases').select('name, source, context, answers, expected, verified, notes').eq('version_id', latest.id),
      'qb_test_cases'
    ),
  ]);
  return {
    version_id: latest.id,
    version_label: latest.version_label,
    ...rules,
    modules,
    protected_questions: protectedRows.map((r) => r.qid),
    test_cases: testCases.map((tc) => ({ ...tc, notes: tc.notes ?? '' })),
  };
}

async function loadRules(supabase: Client, versionId: string) {
  const [scoring, pointRules, overrides, visibility, optionRules, flags, formatRules, reportRules] = await Promise.all([
    one<Scoring>(
      supabase
        .from('qb_scoring')
        .select('scale, bands, rounding, core_module, gate, primary, tier_thresholds, pace, progress, registration')
        .eq('version_id', versionId)
        .maybeSingle(),
      'qb_scoring'
    ),
    rows<PointRule>(
      supabase.from('qb_point_rules').select('key, label, source, qid, points, condition, sort').eq('version_id', versionId).order('sort'),
      'qb_point_rules'
    ),
    rows<Override>(
      supabase.from('qb_overrides').select('key, label, condition, action, sessions, sort').eq('version_id', versionId).order('sort'),
      'qb_overrides'
    ),
    rows<VisibilityRule>(supabase.from('qb_visibility_rules').select('qid, condition').eq('version_id', versionId), 'qb_visibility_rules'),
    rows<OptionRule>(
      supabase.from('qb_option_rules').select('qid, option_code, kind, condition, sort').eq('version_id', versionId).order('sort'),
      'qb_option_rules'
    ),
    rows<Flag>(
      supabase.from('qb_flags').select('key, condition, effects, is_protected, sort').eq('version_id', versionId).order('sort'),
      'qb_flags'
    ),
    rows<FormatRule>(
      supabase.from('qb_format_rules').select('key, condition, format, split, add_text_key, sort').eq('version_id', versionId).order('sort'),
      'qb_format_rules'
    ),
    one<ReportRules>(
      supabase
        .from('qb_report_rules')
        .select('strengths, stuck, focus, tone, interpretation, layouts, format_texts, report_language')
        .eq('version_id', versionId)
        .maybeSingle(),
      'qb_report_rules'
    ),
  ]);
  if (!scoring) throw new Error(`Version ${versionId} has no scoring row.`);
  if (!reportRules) throw new Error(`Version ${versionId} has no report rules row.`);
  return {
    scoring,
    point_rules: pointRules,
    overrides,
    visibility_rules: visibility,
    option_rules: optionRules,
    flags,
    format_rules: formatRules,
    report_rules: reportRules,
  };
}

type QueryResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function rows<T>(query: QueryResult, table: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return (data ?? []) as T[];
}

async function one<T>(query: QueryResult, table: string): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return (data ?? null) as T | null;
}
