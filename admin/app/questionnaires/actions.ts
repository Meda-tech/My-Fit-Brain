'use server';

import { redirect } from 'next/navigation';
import type { Issue } from '@mfb/questionnaire';
import { requireStaff } from '../../lib/auth';
import { createQuestionnaire, importDefinition, publishVersion } from '../../lib/services/questionnaires';

export interface FormState {
  error: string | null;
  errors?: Issue[];
}

export async function createQuestionnaireAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const error = await createQuestionnaire({
    code: String(formData.get('code') ?? ''),
    name_en: String(formData.get('name_en') ?? ''),
    name_hi: String(formData.get('name_hi') ?? ''),
    report_prefix: String(formData.get('report_prefix') ?? ''),
  });
  if (error) return { error };
  redirect(`/questionnaires/${String(formData.get('code')).trim().toUpperCase()}`);
}

export async function importJsonAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { profile } = await requireStaff();
  const code = String(formData.get('code') ?? '');
  const json = String(formData.get('json') ?? '').trim();
  if (!json) return { error: 'Paste the JSON first.' };
  const outcome = await importDefinition(code, json, profile.id);
  if (!outcome.ok) return { error: 'The JSON could not be imported. Fix these and try again:', errors: outcome.errors };
  redirect(`/questionnaires/${code}?v=${outcome.versionId}&imported=${outcome.replaced ? 'replaced' : 'new'}`);
}

export async function publishAction(formData: FormData): Promise<void> {
  const { profile } = await requireStaff();
  const code = String(formData.get('code') ?? '');
  const versionId = String(formData.get('versionId') ?? '');
  await publishVersion(versionId, profile.id);
  redirect(`/questionnaires/${code}?v=${versionId}&published=1`);
}
