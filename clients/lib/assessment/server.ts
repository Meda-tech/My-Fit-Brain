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
  /** Also the pay link: /pay/<code>. */
  code: string;
  name: Text;
  subtitle: Text | null;
}

/** A paid purchase, claimed by the client, not started yet (Start creates the attempt). */
export interface PurchaseCard {
  id: string;
  code: string;
  name: Text;
  paidAt: string;
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
  is_active: boolean;
}

async function questionnaires(): Promise<Map<string, { name: Text; sort: number; active: boolean }>> {
  const { data, error } = await createAdminClient().from('questionnaires').select('code, name_en, name_hi, sort, is_active').order('sort');
  if (error) throw new Error(`Could not read questionnaires: ${error.message}`);
  return new Map(((data ?? []) as QuestionnaireRow[]).map((q) => [q.code, { name: { en: q.name_en, hi: q.name_hi }, sort: q.sort, active: q.is_active !== false }]));
}

/** Live questionnaires (as cards), the client's purchases not started yet, and their own assessments. */
export async function homeData(
  client: ClientProfile
): Promise<{ tests: TestCard[]; purchases: PurchaseCard[]; attempts: AttemptSummary[] }> {
  const db = createAdminClient();
  // Independent reads: run them together instead of one after another.
  const [names, { data: live, error }, { data: ready, error: readyError }, attempts] = await Promise.all([
    questionnaires(),
    db.from('questionnaire_versions').select('questionnaire_code, definition').eq('status', 'live'),
    db
      .from('payments')
      .select('id, test_code, paid_at')
      .eq('client_id', client.id)
      .eq('status', 'paid')
      .is('attempt_id', null)
      .is('refund_status', null)
      .order('paid_at', { ascending: true }),
    serviceDeps().store.listAttempts(client.id),
  ]);
  if (error) throw new Error(`Could not read live versions: ${error.message}`);
  if (readyError) throw new Error(`Could not read purchases: ${readyError.message}`);

  // Only questionnaires switched on in the admin can be bought.
  const tests = ((live ?? []) as { questionnaire_code: string; definition: unknown }[])
    .filter((v) => names.get(v.questionnaire_code)?.active !== false)
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

  return {
    tests,
    purchases: ((ready ?? []) as { id: string; test_code: string; paid_at: string }[]).map((p) => ({
      id: p.id,
      code: p.test_code,
      name: names.get(p.test_code)?.name ?? { en: p.test_code },
      paidAt: p.paid_at,
    })),
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
