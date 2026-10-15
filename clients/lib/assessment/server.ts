import 'server-only';
import { getVersionConfig } from '@mfb/questionbank';
import type { ReportDocument } from '@mfb/report';
import { requireClient } from '../auth';
import { createAdminClient } from '../supabase/admin';
import { paymentsMode } from './payments';
import type { ServiceDeps } from './service';
import { supabaseAttemptStore } from './supabase-store';
import { AssessmentError, type AttemptRow, type AttemptStatus, type ClientProfile, type LocalPair } from './types';

// Server wiring for the assessment screens: dependencies, the signed-in client, and read models.
// Reads use the service role after the ownership check, because clients may not read texts or rules.

/** Report template slot shown on the home cards (the live version's subtitle). */
const SUBTITLE_KEY = 'SUBTITLE';

export function serviceDeps(): ServiceDeps {
  const db = createAdminClient();
  return {
    store: supabaseAttemptStore(db),
    loadConfig: (versionId) => getVersionConfig(db, versionId),
    now: () => new Date(),
    paymentsMode: paymentsMode(),
  };
}

/** The signed-in, registered client (redirects to login or registration otherwise). */
export async function currentClient(): Promise<ClientProfile> {
  const { client } = await requireClient();
  return { id: client.id, gender: client.gender, age: client.age, marital_status: client.marital_status };
}

export interface TestCard {
  code: string;
  name: LocalPair;
  subtitle: LocalPair | null;
}

export interface AttemptSummary {
  id: string;
  reportId: string | null;
  name: LocalPair;
  status: AttemptStatus;
  createdAt: string;
  completedAt: string | null;
}

async function testNames(): Promise<Map<string, { name: LocalPair; sort: number }>> {
  const db = createAdminClient();
  const { data, error } = await db.from('qb_tests').select('code, name_en, name_hi, sort').order('sort');
  if (error) throw new Error(`Could not read tests: ${error.message}`);
  return new Map(
    (data ?? []).map((t: { code: string; name_en: string; name_hi: string | null; sort: number }) => [
      t.code,
      { name: { en: t.name_en, hi: t.name_hi }, sort: t.sort },
    ])
  );
}

export async function homeData(client: ClientProfile): Promise<{ tests: TestCard[]; attempts: AttemptSummary[] }> {
  const db = createAdminClient();
  const names = await testNames();
  const { data: live } = await db.from('qb_versions').select('id, test_code').eq('status', 'live');
  const liveIds = (live ?? []).map((v: { id: string }) => v.id);
  const { data: subtitles } = liveIds.length
    ? await db.from('qb_texts').select('version_id, text_en, text_hi').eq('key', SUBTITLE_KEY).in('version_id', liveIds)
    : { data: [] };

  const tests: TestCard[] = (live ?? [])
    .map((v: { id: string; test_code: string }) => {
      const s = (subtitles ?? []).find((x: { version_id: string }) => x.version_id === v.id) as
        | { text_en: string; text_hi: string }
        | undefined;
      return {
        code: v.test_code,
        name: names.get(v.test_code)?.name ?? { en: v.test_code, hi: null },
        subtitle: s ? { en: s.text_en, hi: s.text_hi } : null,
        sort: names.get(v.test_code)?.sort ?? 0,
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .map((c): TestCard => ({ code: c.code, name: c.name, subtitle: c.subtitle }));

  const attempts = await serviceDeps().store.listAttempts(client.id);
  return {
    tests,
    attempts: attempts.map((a) => ({
      id: a.id,
      reportId: a.report_id,
      name: names.get(a.test_code)?.name ?? { en: a.test_code, hi: null },
      status: a.status,
      createdAt: a.created_at,
      completedAt: a.completed_at,
    })),
  };
}

export async function testName(code: string): Promise<LocalPair | null> {
  return (await testNames()).get(code)?.name ?? null;
}

/** The report-language question of the attempt's version, with one option per language choice. */
export async function languageQuestion(attempt: AttemptRow) {
  const config = await serviceDeps().loadConfig(attempt.version_id);
  const rl = config.report_rules.report_language;
  const q = config.questions.find((x) => x.qid === rl.qid);
  if (!q) return null;
  return {
    text: { en: q.text_en, hi: q.text_hi } as LocalPair,
    options: Object.entries(rl.map).map(([code, langs]) => {
      const o = q.options.find((x) => x.option_code === code);
      return {
        lang: (langs.length > 1 ? 'both' : langs[0]) as 'en' | 'hi' | 'both',
        label: { en: o?.label_en ?? code, hi: o?.label_hi ?? code } as LocalPair,
      };
    }),
  };
}

/** The attempt, if it belongs to the client. */
export async function ownAttemptRow(client: ClientProfile, attemptId: string): Promise<AttemptRow> {
  const attempt = await serviceDeps().store.getAttempt(attemptId);
  if (!attempt || attempt.client_id !== client.id) throw new AssessmentError('NOT_FOUND', 'Assessment not found.');
  return attempt;
}

/** The stored report of a completed attempt of this client, or null. */
export async function storedReport(client: ClientProfile, attemptId: string): Promise<{ attempt: AttemptRow; report: ReportDocument } | null> {
  const attempt = await ownAttemptRow(client, attemptId);
  if (attempt.status !== 'completed') return null;
  const stored = await serviceDeps().store.getResult(attempt.id);
  if (!stored) return null;
  return { attempt, report: stored.report as ReportDocument };
}
