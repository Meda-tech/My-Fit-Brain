import 'server-only';
import { parseDefinition, type Text } from '@mfb/questionnaire';
import { redirect } from 'next/navigation';
import { getAuthUser, requireClient } from '../auth';
import { createAdminClient } from '../supabase/admin';
import type { ServiceDeps } from './service';
import { supabaseAttemptStore } from './supabase-store';
import type { AttemptStatus, ClientProfile } from './types';

// Server wiring for the assessment screens: dependencies, the signed-in client, and read models. Reads
// use the service role after the ownership check, because clients may not read definitions or results.

export function serviceDeps(): ServiceDeps {
  return { store: supabaseAttemptStore(createAdminClient()), now: () => new Date() };
}

/** The signed-in, registered client (redirects to login or registration otherwise). */
export async function currentClient(): Promise<ClientProfile> {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  const { client } = await requireClient();
  return { id: client.id, full_name: client.full_name };
}

export interface TestCard {
  code: string;
  name: Text;
  subtitle: Text | null;
}

export interface AttemptSummary {
  id: string;
  reportId: string;
  name: Text;
  status: AttemptStatus;
  createdAt: string;
  completedAt: string | null;
}

interface QuestionnaireRow {
  code: string;
  name_en: string;
  name_hi: string | null;
  sort: number;
}

async function questionnaires(): Promise<Map<string, { name: Text; sort: number }>> {
  const { data, error } = await createAdminClient().from('questionnaires').select('code, name_en, name_hi, sort').order('sort');
  if (error) throw new Error(`Could not read questionnaires: ${error.message}`);
  return new Map(((data ?? []) as QuestionnaireRow[]).map((q) => [q.code, { name: { en: q.name_en, hi: q.name_hi }, sort: q.sort }]));
}

/** Live questionnaires (as cards) and the client's own assessments. */
export async function homeData(client: ClientProfile): Promise<{ tests: TestCard[]; attempts: AttemptSummary[] }> {
  const db = createAdminClient();
  const names = await questionnaires();
  const { data: live, error } = await db.from('questionnaire_versions').select('questionnaire_code, definition').eq('status', 'live');
  if (error) throw new Error(`Could not read live versions: ${error.message}`);

  const tests = ((live ?? []) as { questionnaire_code: string; definition: unknown }[])
    .map((v) => {
      const parsed = parseDefinition(v.definition);
      const info = names.get(v.questionnaire_code);
      return {
        code: v.questionnaire_code,
        name: info?.name ?? { en: v.questionnaire_code },
        subtitle: parsed.ok ? parsed.definition.subtitle : null,
        sort: info?.sort ?? 0,
      };
    })
    .sort((a, b) => a.sort - b.sort)
    .map(({ code, name, subtitle }): TestCard => ({ code, name, subtitle }));

  const attempts = await serviceDeps().store.listAttempts(client.id);
  return {
    tests,
    attempts: attempts.map((a) => ({
      id: a.id,
      reportId: a.report_id,
      name: names.get(a.questionnaire_code)?.name ?? { en: a.questionnaire_code },
      status: a.status,
      createdAt: a.created_at,
      completedAt: a.completed_at,
    })),
  };
}

export async function questionnaireName(code: string): Promise<Text | null> {
  return (await questionnaires()).get(code)?.name ?? null;
}

export interface AttemptSummaryDetails {
  testName: Text;
  reportId: string;
  completedAt: string | null;
}

/** Name, reference and completion date of the client's own attempt (for the thank-you screen). */
export async function attemptDetails(client: ClientProfile, attemptId: string): Promise<AttemptSummaryDetails | null> {
  const attempt = await serviceDeps().store.getAttempt(attemptId);
  if (!attempt || attempt.client_id !== client.id) return null;
  return {
    testName: (await questionnaireName(attempt.questionnaire_code)) ?? { en: attempt.questionnaire_code },
    reportId: attempt.report_id,
    completedAt: attempt.completed_at,
  };
}
