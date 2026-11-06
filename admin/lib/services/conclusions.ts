import { requireStaff } from '../auth';
import { createAdminClient } from '../supabase/admin';
import { cleanConclusion, type Conclusion } from '../conclusion';
import { CONCLUSION_COLUMNS, canViewReports } from './attempts';

// The counsellor's conclusion on a completed assessment (table attempt_conclusions). Written and edited at
// any time by super admins and counsellors, through the server (service role); read in getAttemptDetail
// under RLS (can_view_reports()). Printed at the end of the report PDF ("Summary and suggestions"); never
// in any notification.

const STALE =
  'Someone else saved this conclusion while you were editing. Copy your text, reload the page and add your changes to the latest version.';

/**
 * Writes the first conclusion (expectedUpdatedAt null) or replaces the text of the existing one. The
 * replace only goes through when nobody saved in between (same updated_at), so two counsellors never
 * overwrite each other without seeing it.
 */
export async function saveConclusion(
  attemptId: string,
  raw: unknown,
  expectedUpdatedAt: string | null
): Promise<{ error: string; conclusion?: undefined } | { error: null; conclusion: Conclusion }> {
  const { profile } = await requireStaff();
  if (!canViewReports(profile.role)) return { error: 'Only counsellors and super admins can write conclusions.' };
  const parsed = cleanConclusion(raw);
  if (!parsed.ok) return { error: parsed.error };

  const db = createAdminClient();
  const edit = { body: parsed.body, updated_by: profile.id, updated_by_name: profile.full_name };
  const { data, error } =
    expectedUpdatedAt === null
      ? await db
          .from('attempt_conclusions')
          .insert({ attempt_id: attemptId, created_by: profile.id, ...edit })
          .select(CONCLUSION_COLUMNS)
          .maybeSingle()
      : await db
          .from('attempt_conclusions')
          .update(edit)
          .eq('attempt_id', attemptId)
          .eq('updated_at', expectedUpdatedAt)
          .select(CONCLUSION_COLUMNS)
          .maybeSingle();

  if (error) {
    if (error.code === '23505') return { error: STALE }; // someone wrote the first one meanwhile
    if (error.code === '42501') return { error: 'A conclusion can be written once the client has completed the assessment.' };
    console.error(`Saving the conclusion of attempt ${attemptId} failed:`, error.message);
    return { error: 'The conclusion could not be saved. Please try again.' };
  }
  if (!data) return { error: STALE };
  return { error: null, conclusion: data as Conclusion };
}
