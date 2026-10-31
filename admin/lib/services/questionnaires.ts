import { parseClientDetails, parseDefinition, type ClientDetail, type Issue } from '@mfb/questionnaire';
import { requireStaff } from '../auth';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';

// Questionnaires and their versions. Reads go through the staff session (RLS: active staff); writes run
// on the service role after the role check here. Published versions never change (database trigger).

/** Roles that may import and publish questionnaires. Counsellors read. */
export const EDIT_ROLES = ['super_admin', 'coordinator'] as const;

export function canEditQuestionnaires(role: string): boolean {
  return (EDIT_ROLES as readonly string[]).includes(role);
}

export type VersionStatus = 'draft' | 'live' | 'retired';

export const STATUS_LABELS: Record<VersionStatus, string> = { draft: 'Draft', live: 'Live', retired: 'Retired' };

export interface QuestionnaireRow {
  code: string;
  name_en: string;
  name_hi: string | null;
  report_prefix: string;
  /** Neutral code of the public pay link (clients app /pay/<pay_code>). */
  pay_code: string;
  sort: number;
  /** The current client-details list (not versioned; edited at any time). */
  client_details: ClientDetail[];
}

export interface VersionRow {
  id: string;
  questionnaire_code: string;
  number: number;
  status: VersionStatus;
  created_at: string;
  published_at: string | null;
  published_by_name: string | null;
}

export interface VersionWithDefinition extends VersionRow {
  definition: unknown;
}

const VERSION_COLUMNS = 'id, questionnaire_code, number, status, created_at, published_at, profiles:published_by(full_name)';

type RawVersion = Omit<VersionRow, 'published_by_name'> & { profiles?: { full_name?: string | null } | null; definition?: unknown };

function toVersion(r: RawVersion): VersionRow {
  return {
    id: r.id,
    questionnaire_code: r.questionnaire_code,
    number: r.number,
    status: r.status,
    created_at: r.created_at,
    published_at: r.published_at,
    published_by_name: r.profiles?.full_name ?? null,
  };
}

export async function listQuestionnaires(): Promise<{ questionnaire: QuestionnaireRow; versions: VersionRow[] }[]> {
  await requireStaff();
  const supabase = await createClient();
  const [q, v] = await Promise.all([
    supabase.from('questionnaires').select('code, name_en, name_hi, report_prefix, pay_code, sort, client_details').order('sort'),
    supabase.from('questionnaire_versions').select(VERSION_COLUMNS).order('number', { ascending: false }),
  ]);
  if (q.error) {
    if (q.error.code === '42P01') return []; // tables not created yet
    throw new Error(`Could not read questionnaires: ${q.error.message}`);
  }
  if (v.error) throw new Error(`Could not read versions: ${v.error.message}`);
  const versions = ((v.data ?? []) as unknown as RawVersion[]).map(toVersion);
  return ((q.data ?? []) as (Omit<QuestionnaireRow, 'client_details'> & { client_details: unknown })[]).map((row) => {
    const details = parseClientDetails(row.client_details);
    return {
      questionnaire: { ...row, client_details: details.ok ? details.details : [] },
      versions: versions.filter((x) => x.questionnaire_code === row.code),
    };
  });
}

export async function getQuestionnaire(code: string): Promise<{ questionnaire: QuestionnaireRow; versions: VersionRow[] } | null> {
  return (await listQuestionnaires()).find((x) => x.questionnaire.code === code) ?? null;
}

export async function getVersion(id: string): Promise<VersionWithDefinition | null> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from('questionnaire_versions').select(`${VERSION_COLUMNS}, definition`).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not read the version: ${error.message}`);
  if (!data) return null;
  const raw = data as unknown as RawVersion;
  return { ...toVersion(raw), definition: raw.definition };
}

export type ImportOutcome = { ok: true; versionId: string; number: number; replaced: boolean; warnings: Issue[] } | { ok: false; errors: Issue[]; warnings: Issue[] };

/**
 * Imports pasted JSON as the questionnaire's draft: replaces the open draft, or creates the next version
 * number. Blocked only by the four hard errors of parseDefinition.
 */
export async function importDefinition(code: string, json: string, profileId: string): Promise<ImportOutcome> {
  const { profile } = await requireStaff();
  if (!canEditQuestionnaires(profile.role)) return { ok: false, errors: [{ where: 'Rights', message: 'Only super admins and coordinators can import questionnaires.' }], warnings: [] };
  const parsed = parseDefinition(json);
  if (!parsed.ok) return parsed;
  const definition = JSON.parse(json) as unknown; // stored as pasted (parse succeeded above)

  const db = createAdminClient();
  const { data: existing, error } = await db.from('questionnaire_versions').select('id, number, status').eq('questionnaire_code', code).order('number', { ascending: false });
  if (error) throw new Error(`Could not read versions: ${error.message}`);
  const rows = (existing ?? []) as { id: string; number: number; status: VersionStatus }[];
  const draft = rows.find((r) => r.status === 'draft');
  if (draft) {
    const u = await db.from('questionnaire_versions').update({ definition }).eq('id', draft.id);
    if (u.error) throw new Error(`Could not replace the draft: ${u.error.message}`);
    return { ok: true, versionId: draft.id, number: draft.number, replaced: true, warnings: parsed.warnings };
  }
  const number = (rows[0]?.number ?? 0) + 1;
  const i = await db
    .from('questionnaire_versions')
    .insert({ questionnaire_code: code, number, status: 'draft', definition, created_by: profileId })
    .select('id')
    .single();
  if (i.error) throw new Error(`Could not create the draft: ${i.error.message}`);
  return { ok: true, versionId: (i.data as { id: string }).id, number, replaced: false, warnings: parsed.warnings };
}

/**
 * Publishes the draft. When its JSON has "client_details", that list becomes the questionnaire's
 * client-details list; a JSON without it keeps the current list.
 */
export async function publishVersion(versionId: string, profileId: string): Promise<void> {
  const { profile } = await requireStaff();
  if (!canEditQuestionnaires(profile.role)) throw new Error('Only super admins and coordinators can publish.');
  const db = createAdminClient();
  const { error } = await db.rpc('publish_questionnaire_version', { p_version_id: versionId, p_by: profileId });
  if (error) throw new Error(`Could not publish: ${error.message}`);

  const { data, error: readError } = await db.from('questionnaire_versions').select('questionnaire_code, definition').eq('id', versionId).single();
  if (readError) throw new Error(`Could not read the published version: ${readError.message}`);
  const row = data as { questionnaire_code: string; definition: unknown };
  const parsed = parseDefinition(row.definition);
  if (parsed.ok && parsed.definition.client_details) {
    const u = await db.from('questionnaires').update({ client_details: parsed.definition.client_details }).eq('code', row.questionnaire_code);
    if (u.error) throw new Error(`Published, but the client details could not be updated: ${u.error.message}`);
  }
}

/**
 * Replaces the questionnaire's client-details list. It takes effect at once, also for clients who have
 * not reached these questions yet; answers already given keep the question text as it was asked.
 */
export async function saveClientDetails(code: string, list: unknown): Promise<{ ok: true } | { ok: false; errors: Issue[] }> {
  const { profile } = await requireStaff();
  if (!canEditQuestionnaires(profile.role)) return { ok: false, errors: [{ where: 'Rights', message: 'Only super admins and coordinators can change client details.' }] };
  const parsed = parseClientDetails(list, 'Client details');
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const { error } = await createAdminClient().from('questionnaires').update({ client_details: parsed.details }).eq('code', code);
  if (error) throw new Error(`Could not save the client details: ${error.message}`);
  return { ok: true };
}

export async function createQuestionnaire(input: { code: string; name_en: string; name_hi: string; report_prefix: string }): Promise<string | null> {
  const { profile } = await requireStaff();
  if (!canEditQuestionnaires(profile.role)) return 'Only super admins and coordinators can add questionnaires.';
  const code = input.code.trim().toUpperCase();
  const prefix = input.report_prefix.trim().toUpperCase();
  if (!/^[A-Z]{1,8}$/.test(code)) return 'The code is 1–8 capital letters, e.g. IA.';
  if (!/^[A-Z-]{2,16}$/.test(prefix)) return 'The report ID prefix is capital letters and dashes, e.g. MFB-IA.';
  if (!input.name_en.trim()) return 'The English name is needed.';
  const db = createAdminClient();
  const { count } = await db.from('questionnaires').select('code', { count: 'exact', head: true });
  const { error } = await db.from('questionnaires').insert({
    code,
    name_en: input.name_en.trim(),
    name_hi: input.name_hi.trim() || null,
    report_prefix: prefix,
    sort: (count ?? 0) + 1,
  });
  if (error) return error.code === '23505' ? 'That code or report prefix is already used.' : `Could not add the questionnaire: ${error.message}`;
  return null;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}
