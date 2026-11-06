import 'server-only';
import { counsellorView, pick } from '@mfb/questionnaire';
import { requireStaff } from '../auth';
import { createClient } from '../supabase/server';
import { AiNotConfiguredError, generateJson } from '../ai/gemini';
import { CONCLUSION_RESPONSE_SCHEMA, CONCLUSION_SYSTEM_PROMPT, buildConclusionInput, conclusionFromAi } from '../ai/conclusion-prompt';
import { canViewReports, getAttemptDetail, reportInEnglish } from './attempts';

// "Draft with AI" on the counsellor's conclusion: builds the compact input from the stored report, the
// counsellor view and the client's typed details, asks Gemini, and returns plain text for the editor.
// Nothing is saved here; the counsellor reviews the draft and saves it like any conclusion.

export async function draftConclusion(attemptId: string): Promise<{ error: string; body?: undefined } | { error: null; body: string }> {
  const { profile } = await requireStaff();
  if (!canViewReports(profile.role)) return { error: 'Only counsellors and super admins can write conclusions.' };

  const detail = await getAttemptDetail(attemptId);
  if (!detail) return { error: 'Assessment not found.' };
  if (detail.attempt.status !== 'completed' || !detail.report) {
    return { error: 'A conclusion can be written once the client has completed the assessment.' };
  }

  const supabase = await createClient();
  const { data: client } = await supabase
    .from('clients')
    .select('age, gender, marital_status')
    .eq('id', detail.attempt.client_id)
    .maybeSingle();
  const c = (client ?? {}) as { age?: number | null; gender?: string | null; marital_status?: string | null };

  const view = detail.definition && detail.answers ? counsellorView(detail.definition, detail.answers, detail.result) : null;
  const input = buildConclusionInput({
    questionnaire: detail.attempt.questionnaire_name,
    report: reportInEnglish(detail) ?? detail.report,
    view,
    client: { age: c.age ?? null, gender: c.gender ?? null, relationship: c.marital_status ?? null },
    details: (detail.details ?? []).map((d) => ({ question: pick(d.question, 'en'), answer: d.answer })),
  });

  try {
    const raw = await generateJson({ system: CONCLUSION_SYSTEM_PROMPT, user: input, schema: CONCLUSION_RESPONSE_SCHEMA });
    const parsed = conclusionFromAi(raw);
    if (!parsed.ok) {
      console.error(`AI conclusion for attempt ${attemptId}: unusable answer (${parsed.error})`);
      return { error: 'The AI answer could not be read. Please try again.' };
    }
    return { error: null, body: parsed.body };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) return { error: 'AI drafting is not set up. Ask a super admin.' };
    console.error(`AI conclusion for attempt ${attemptId} failed:`, err instanceof Error ? err.message : err);
    return { error: 'The AI draft could not be made. Please try again in a minute.' };
  }
}
