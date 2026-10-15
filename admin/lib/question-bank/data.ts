import { getVersionConfig, type QbTest, type ValidationIssue, type VersionStatus } from '@mfb/questionbank';
import { createClient } from '../supabase/server';
import type { Profile } from '../types';

// Server-side reads for the question bank screens. RLS limits every query to active staff.

export interface ContentRights {
  canEdit: boolean;
  canApprove: boolean;
}

export function contentRights(profile: Profile): ContentRights {
  return { canEdit: profile.can_edit_content === true, canApprove: profile.can_approve_content === true };
}

export interface VersionRow {
  id: string;
  test_code: string;
  version_label: string;
  status: VersionStatus;
  based_on_version_id: string | null;
  change_note: string | null;
  source_file_name: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  published_at: string | null;
  retired_at: string | null;
  creator: string | null;
  submitter: string | null;
  approver: string | null;
}

export interface LastChange {
  at: string;
  by: string | null;
  what: string;
}

export interface TestOverview {
  test: QbTest;
  versions: VersionRow[];
  live: VersionRow | null;
  open: VersionRow | null;
  lastChange: LastChange | null;
}

export type Overview = { ready: false } | { ready: true; tests: TestOverview[] };

const VERSION_COLUMNS =
  'id, test_code, version_label, status, based_on_version_id, change_note, source_file_name, created_at, ' +
  'updated_at, submitted_at, approved_at, published_at, retired_at, ' +
  'creator:created_by(full_name), submitter:submitted_by(full_name), approver:approved_by(full_name)';

type Named = { full_name?: string | null } | null;
type RawVersion = Omit<VersionRow, 'creator' | 'submitter' | 'approver'> & {
  creator: Named;
  submitter: Named;
  approver: Named;
};

function toVersion(row: RawVersion): VersionRow {
  return {
    ...row,
    creator: row.creator?.full_name ?? null,
    submitter: row.submitter?.full_name ?? null,
    approver: row.approver?.full_name ?? null,
  };
}

/** Tables missing (migration not applied yet) or not in the API schema cache. */
function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST200');
}

export async function loadOverview(): Promise<Overview> {
  const supabase = await createClient();
  const { data: tests, error } = await supabase.from('qb_tests').select('*').order('sort');
  if (isMissingTable(error)) return { ready: false };
  if (error) throw new Error(`Could not read tests: ${error.message}`);

  const { data: versionRows, error: vErr } = await supabase
    .from('qb_versions')
    .select(VERSION_COLUMNS)
    .order('created_at', { ascending: false });
  if (vErr) throw new Error(`Could not read versions: ${vErr.message}`);
  const versions = ((versionRows ?? []) as unknown as RawVersion[]).map(toVersion);

  const overview: TestOverview[] = [];
  for (const test of (tests ?? []) as QbTest[]) {
    const own = versions.filter((v) => v.test_code === test.code);
    overview.push({
      test,
      versions: own,
      live: own.find((v) => v.status === 'live') ?? null,
      open: own.find((v) => v.status === 'draft' || v.status === 'in_review') ?? null,
      lastChange: await loadLastChange(own.map((v) => v.id)),
    });
  }
  return { ready: true, tests: overview };
}

async function loadLastChange(versionIds: string[]): Promise<LastChange | null> {
  if (versionIds.length === 0) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('qb_audit_log')
    .select('changed_at, table_name, action, editor:changed_by(full_name)')
    .in('version_id', versionIds)
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { changed_at: string; table_name: string; action: string; editor: Named };
  return { at: row.changed_at, by: row.editor?.full_name ?? null, what: describeChange(row.table_name, row.action) };
}

export function describeChange(table: string, action: string): string {
  const name = table.replace(/^qb_/, '').replace(/_/g, ' ');
  if (table === 'qb_versions') return action === 'INSERT' ? 'version created' : 'version status or details changed';
  return `${name} ${action === 'INSERT' ? 'added' : action === 'UPDATE' ? 'edited' : 'removed'}`;
}

export async function loadVersion(versionId: string): Promise<VersionRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('qb_versions').select(VERSION_COLUMNS).eq('id', versionId).maybeSingle();
  if (error && !isMissingTable(error)) throw new Error(`Could not read version: ${error.message}`);
  if (!data) return null;
  return toVersion(data as unknown as RawVersion);
}

export async function loadVersionConfig(versionId: string) {
  const supabase = await createClient();
  return getVersionConfig(supabase, versionId);
}

export interface TestCaseRow {
  id: string;
  name: string;
  source: string;
  context: Record<string, unknown>;
  answers: Record<string, string | string[]>;
  expected: Record<string, unknown>;
  verified: boolean;
  notes: string | null;
}

export async function loadTestCases(versionId: string): Promise<TestCaseRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('qb_test_cases')
    .select('id, name, source, context, answers, expected, verified, notes')
    .eq('version_id', versionId)
    .order('name');
  if (error) throw new Error(`Could not read test cases: ${error.message}`);
  return (data ?? []) as TestCaseRow[];
}

export async function loadValidation(versionId: string): Promise<ValidationIssue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('qb_validate_version', { p_version_id: versionId });
  if (error) throw new Error(`Could not validate: ${error.message}`);
  return (data ?? []) as ValidationIssue[];
}

export interface AuditRow {
  id: number;
  table_name: string;
  action: string;
  row_key: Record<string, unknown>;
  changed_at: string;
  editor: string | null;
}

export async function loadHistory(versionId: string, limit = 200): Promise<{ rows: AuditRow[]; total: number }> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from('qb_audit_log')
    .select('id, table_name, action, row_key, changed_at, editor:changed_by(full_name)', { count: 'exact' })
    .eq('version_id', versionId)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read history: ${error.message}`);
  const rows = ((data ?? []) as unknown as (Omit<AuditRow, 'editor'> & { editor: Named })[]).map((r) => ({
    ...r,
    editor: r.editor?.full_name ?? null,
  }));
  return { rows, total: count ?? rows.length };
}

/** The open (draft or in-review) version of a test, if any. */
export async function loadOpenVersion(testCode: string): Promise<{ version_label: string; status: VersionStatus } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('qb_versions')
    .select('version_label, status')
    .eq('test_code', testCode)
    .in('status', ['draft', 'in_review'])
    .maybeSingle();
  return (data as { version_label: string; status: VersionStatus } | null) ?? null;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export const STATUS_LABELS: Record<VersionStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  live: 'Live',
  retired: 'Retired',
};
