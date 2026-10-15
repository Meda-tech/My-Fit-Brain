import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getVersionConfig, type VersionConfig } from '@mfb/questionbank';
import { score } from './score';
import { resolveReportTexts, type ReportLanguage, type ResolvedReport } from './texts';
import type { Answers, AssessmentResult, EngineContext } from './types';

// Thin server-side helpers used by both apps. Scoring runs only on the server: the browser sends option
// codes, the server loads the version, scores and stores the result.

/** The full configuration of a version (live and retired versions are cached; drafts never). */
export async function loadConfig(supabase: SupabaseClient, versionId: string): Promise<VersionConfig> {
  return getVersionConfig(supabase, versionId);
}

/** Scores an attempt on a version and resolves the report texts in the given language. */
export async function scoreAttempt(
  supabase: SupabaseClient,
  versionId: string,
  context: EngineContext,
  answers: Answers,
  lang: ReportLanguage = 'en'
): Promise<AssessmentResult & { texts: ResolvedReport }> {
  const config = await loadConfig(supabase, versionId);
  const result = score(config, context, answers);
  return { ...result, texts: resolveReportTexts(config, result, lang) };
}
