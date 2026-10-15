'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadLatestRules, type RulesSource, type ValidationIssue } from '@mfb/questionbank';
import { prepareImport, type ImportPreview } from '@mfb/questionbank/import';
import { requireStaff } from '../../lib/auth';
import { contentRights, loadOpenVersion, STATUS_LABELS } from '../../lib/question-bank/data';
import { createClient } from '../../lib/supabase/server';

// Question bank actions. Every change goes through a qb_* database function, which checks the
// caller's permission again; the screens only hide what a user cannot do.

export interface QbActionState {
  ok: boolean;
  error?: string;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const VERSION_LABEL = /^[0-9]+(\.[0-9]+)*$/;

async function requireEditor() {
  const staff = await requireStaff();
  if (!contentRights(staff.profile).canEdit) {
    return { staff, error: 'You do not have permission to edit question bank content.' };
  }
  return { staff, error: null };
}

export async function startNewVersionAction(_prev: QbActionState | null, formData: FormData): Promise<QbActionState> {
  const { error: denied } = await requireEditor();
  if (denied) return { ok: false, error: denied };

  const testCode = String(formData.get('testCode') ?? '');
  const label = String(formData.get('versionLabel') ?? '').trim();
  if (!VERSION_LABEL.test(label)) return { ok: false, error: 'Use a version number such as 1.2.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('qb_start_new_version', { p_test_code: testCode, p_version_label: label });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not start a new version.' };

  revalidatePath('/question-bank');
  redirect(`/question-bank/${data}`);
}

type StatusAction = 'submit' | 'return' | 'publish' | 'delete';

export async function versionStatusAction(_prev: QbActionState | null, formData: FormData): Promise<QbActionState> {
  const staff = await requireStaff();
  const rights = contentRights(staff.profile);
  const versionId = String(formData.get('versionId') ?? '');
  const action = String(formData.get('action') ?? '') as StatusAction;
  const supabase = await createClient();

  let result: { error: { message: string } | null };
  switch (action) {
    case 'submit':
      if (!rights.canEdit) return { ok: false, error: 'You do not have permission to submit versions.' };
      result = await supabase.rpc('qb_submit_for_review', { p_version_id: versionId });
      break;
    case 'return':
      if (!rights.canEdit && !rights.canApprove) return { ok: false, error: 'You do not have permission to change versions.' };
      result = await supabase.rpc('qb_return_to_draft', { p_version_id: versionId });
      break;
    case 'publish': {
      if (!rights.canApprove) return { ok: false, error: 'You do not have permission to publish versions.' };
      const note = String(formData.get('changeNote') ?? '').trim();
      if (!note) return { ok: false, error: 'Add a change note before publishing.' };
      result = await supabase.rpc('qb_publish', { p_version_id: versionId, p_change_note: note });
      break;
    }
    case 'delete':
      if (!rights.canEdit) return { ok: false, error: 'You do not have permission to delete drafts.' };
      result = await supabase.rpc('qb_delete_draft', { p_version_id: versionId });
      break;
    default:
      return { ok: false, error: 'Unknown action.' };
  }
  if (result.error) return { ok: false, error: result.error.message };

  revalidatePath('/question-bank');
  if (action === 'delete') redirect('/question-bank');
  revalidatePath(`/question-bank/${versionId}`);
  return { ok: true };
}

export interface ImportCheckState {
  ok: boolean;
  fileName?: string;
  preview?: ImportPreview | null;
  source?: RulesSource | null;
  errors: string[];
  warnings: string[];
  issues: ValidationIssue[];
  /** A draft or in-review version already exists for the detected test. */
  blockedBy?: string | null;
}

async function readUpload(formData: FormData): Promise<{ file: File | null; error: string | null }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { file: null, error: 'Choose an .xlsx file to import.' };
  if (!file.name.toLowerCase().endsWith('.xlsx')) return { file: null, error: 'Only .xlsx files can be imported.' };
  if (file.size > MAX_UPLOAD_BYTES) return { file: null, error: 'The file is larger than 5 MB.' };
  return { file, error: null };
}

async function prepare(file: File, changeNote: string | null) {
  const supabase = await createClient();
  const { data: tests, error } = await supabase.from('qb_tests').select('code, name_en');
  if (error) throw new Error(`Could not read tests: ${error.message}`);
  return prepareImport(new Uint8Array(await file.arrayBuffer()), {
    fileName: file.name,
    tests: tests ?? [],
    loadLatest: (code) => loadLatestRules(supabase, code),
    changeNote,
  });
}

export async function checkImportAction(_prev: ImportCheckState | null, formData: FormData): Promise<ImportCheckState> {
  const { error: denied } = await requireEditor();
  if (denied) return { ok: false, errors: [denied], warnings: [], issues: [] };
  const { file, error } = await readUpload(formData);
  if (!file) return { ok: false, errors: [error!], warnings: [], issues: [] };

  try {
    const prepared = await prepare(file, null);
    const open = prepared.preview ? await loadOpenVersion(prepared.preview.test_code) : null;
    const blockedBy = open
      ? `${prepared.preview!.test_code} already has version ${open.version_label} (${STATUS_LABELS[open.status].toLowerCase()}). Publish, return or delete it before importing another.`
      : null;
    return {
      ok: prepared.ok && !blockedBy,
      fileName: file.name,
      preview: prepared.preview,
      source: prepared.source,
      errors: prepared.errors,
      warnings: prepared.warnings,
      issues: prepared.issues,
      blockedBy,
    };
  } catch (err) {
    console.error('Question bank import check failed:', err);
    return { ok: false, fileName: file.name, errors: ['The file could not be checked. Please try again.'], warnings: [], issues: [] };
  }
}

export async function createDraftAction(_prev: QbActionState | null, formData: FormData): Promise<QbActionState> {
  const { error: denied } = await requireEditor();
  if (denied) return { ok: false, error: denied };
  const { file, error } = await readUpload(formData);
  if (!file) return { ok: false, error: error! };

  let versionId: string;
  try {
    const changeNote = String(formData.get('changeNote') ?? '').trim() || null;
    const prepared = await prepare(file, changeNote);
    if (!prepared.ok || !prepared.payload) return { ok: false, error: 'The file has errors. Check it again and fix them first.' };

    const supabase = await createClient();
    const { data, error: rpcError } = await supabase.rpc('qb_import_version', { payload: prepared.payload });
    if (rpcError || !data) return { ok: false, error: rpcError?.message ?? 'Could not create the draft.' };
    versionId = data as string;
  } catch (err) {
    console.error('Question bank import failed:', err);
    return { ok: false, error: 'The draft could not be created. Please try again.' };
  }

  revalidatePath('/question-bank');
  redirect(`/question-bank/${versionId}`);
}
