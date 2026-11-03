import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import { normalizePhoneNumber } from '../phone';
import { canViewPayments } from './payments';
import { ProofStorageNotConfiguredError, isProofStorageConfigured, uploadProof } from '../google/drive';
import { ASSESSMENT_PRICE_PAISE, cleanReference, parseOfflinePayment, proofProblem } from '../offline-payments';

// "Add offline payment" on a client's profile (super admins and coordinators). The client paid outside
// Razorpay (UPI to our number, bank transfer, other); staff record it with the proof. Order:
//   1. check the role, the fields, the client and the assessment (live and switched on)
//   2. upload the proof to Google Drive (service account, ../google/drive.ts); on any failure nothing is saved
//   3. insert a PAID purchase linked to the client (provider offline), so Home shows Start at once
// The amount is the fixed price (no discounts). Online payments fire no "paid" message yet, so neither
// does this. Nothing is ever deleted: a proof uploaded before a failed insert stays in Drive (logged).

export const STORAGE_NOT_SET_UP = 'Proof storage is not set up. Ask a super admin.';
export const PROOF_UPLOAD_FAILED = 'Proof could not be uploaded. Please try again.';

export interface PayableQuestionnaire {
  code: string;
  name: string;
}

/** Questionnaires that can be bought now: a live version and switched on (Admin → Questionnaires). */
export async function payableQuestionnaires(): Promise<PayableQuestionnaire[]> {
  const db = createAdminClient();
  const [{ data: qs, error }, { data: live, error: liveError }] = await Promise.all([
    db.from('questionnaires').select('code, name_en, sort, is_active').eq('is_active', true).order('sort'),
    db.from('questionnaire_versions').select('questionnaire_code').eq('status', 'live'),
  ]);
  if (error || liveError) throw new Error(`Could not read questionnaires: ${(error ?? liveError)!.message}`);
  const liveCodes = new Set(((live ?? []) as { questionnaire_code: string }[]).map((v) => v.questionnaire_code));
  return ((qs ?? []) as { code: string; name_en: string }[]).filter((q) => liveCodes.has(q.code)).map((q) => ({ code: q.code, name: q.name_en }));
}

export interface ReferenceUse {
  id: string;
  created_at: string;
  status: string;
}

/** Other payments with the same reference (any case, spaces collapsed). For a warning only. */
export async function referenceUses(raw: string): Promise<ReferenceUse[]> {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return [];
  const reference = cleanReference(raw);
  if (!reference) return [];
  // ilike without wildcards = case-insensitive equality. Text holding a wildcard (* % _ \) is compared
  // exactly instead.
  const query = createAdminClient().from('payments').select('id, created_at, status');
  const { data, error } = await (/[*%_\\]/.test(reference) ? query.eq('reference', reference) : query.ilike('reference', reference))
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return [];
  return (data ?? []) as ReferenceUse[];
}

export type RecordResult = { ok: true; paymentId: string; duplicateReference: boolean } | { ok: false; error: string };

export async function recordOfflinePayment(clientId: string, form: FormData): Promise<RecordResult> {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return { ok: false, error: 'Only super admins and coordinators can record payments.' };

  const parsed = parseOfflinePayment({
    code: form.get('code'),
    method: form.get('method'),
    paidOn: form.get('paidOn'),
    reference: form.get('reference'),
    note: form.get('note'),
  });
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  const proof = form.get('proof');
  const bytes = proof instanceof File && proof.size > 0 ? new Uint8Array(await proof.arrayBuffer()) : null;
  const problem = proofProblem(bytes);
  if (problem) return { ok: false, error: problem };

  const db = createAdminClient();
  const { data: client } = await db.from('clients').select('id, phone').eq('id', clientId).maybeSingle();
  if (!client) return { ok: false, error: 'Client not found.' };
  const phone = normalizePhoneNumber((client as { phone: string }).phone);
  if (!phone.valid) return { ok: false, error: 'The client’s mobile number is not valid. Fix it before recording a payment.' };

  const payable = await payableQuestionnaires();
  if (!payable.some((q) => q.code === input.code)) return { ok: false, error: 'This assessment cannot be bought right now.' };

  if (!isProofStorageConfigured()) {
    console.error('Offline payment blocked: proof storage env (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID) missing or invalid.');
    return { ok: false, error: STORAGE_NOT_SET_UP };
  }
  const duplicateReference = (await referenceUses(input.reference)).length > 0;

  // 2. Proof first: no proof, no payment.
  const paymentId = randomUUID();
  let uploaded: { fileId: string; webViewLink: string };
  try {
    uploaded = await uploadProof(bytes!, paymentId);
  } catch (err) {
    // Google's real error, server log only.
    console.error(`Offline payment ${paymentId}: proof upload failed:`, err instanceof Error ? err.message : err);
    return { ok: false, error: err instanceof ProofStorageNotConfiguredError ? STORAGE_NOT_SET_UP : PROOF_UPLOAD_FAILED };
  }

  // 3. The paid purchase. The order / payment IDs are our own (unique; the attempt's payment_ref).
  const now = new Date().toISOString();
  const { error } = await db.from('payments').insert({
    id: paymentId,
    phone: phone.normalized,
    client_id: clientId,
    claimed_at: now,
    test_code: input.code,
    provider: 'offline',
    amount_paise: ASSESSMENT_PRICE_PAISE,
    currency: 'INR',
    status: 'paid',
    provider_order_id: `offline_${paymentId}`,
    provider_payment_id: `offline_${paymentId}`,
    method: input.method,
    reference: input.reference,
    note: input.note,
    paid_at: input.paidAt,
    recorded_by: profile.id,
    proof_file_id: uploaded.fileId,
    proof_url: uploaded.webViewLink,
  });
  if (error) {
    console.error(`Offline payment ${paymentId} not saved (proof kept in Drive, file ${uploaded.fileId}):`, error.message);
    return { ok: false, error: 'The payment could not be saved. Please try again.' };
  }
  return { ok: true, paymentId, duplicateReference };
}
