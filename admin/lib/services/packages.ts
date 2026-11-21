import 'server-only';
import { randomUUID } from 'node:crypto';
import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import { ProofStorageNotConfiguredError, isProofStorageConfigured, uploadProof } from '../google/drive';
import { cleanReference, parseOfflinePayment, proofProblem } from '../offline-payments';
import { parsePackageSettings, type PackageOffer, type PackageSettings } from '../package';
import { PROOF_UPLOAD_FAILED, STORAGE_NOT_SET_UP } from './offline-payments';
import { canViewPurchases, nameLookup } from './purchases';

// Package (step 6): settings (super admins), the manual package payment (coordinators for their own clients, super
// admins for anyone) and the lists. The database calculates the amount and checks every rule again.

// --- Settings ----------------------------------------------------------------------------------------------

export async function getPackage(): Promise<PackageSettings | null> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return null;
  const db = await createClient();
  const { data } = await db.from('packages').select('name, sessions, frequency, price_paise, updated_at').eq('is_active', true).maybeSingle();
  return (data as PackageSettings | null) ?? null;
}

export async function savePackage(fields: { name: unknown; sessions: unknown; frequency: unknown; price: unknown }): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return { success: false, error: 'Only super admins can change the package.' };
  const parsed = parsePackageSettings(fields);
  if (!parsed.ok) return { success: false, error: parsed.error };
  const { error } = await createAdminClient().rpc('package_save', {
    p_by: profile.id,
    p_name: parsed.value.name,
    p_sessions: parsed.value.sessions,
    p_frequency: parsed.value.frequency,
    p_price_paise: parsed.value.price_paise,
  });
  if (error) {
    console.error('package_save failed:', error.message);
    return { success: false, error: 'The package could not be saved. Please try again.' };
  }
  return { success: true };
}

// --- The offer of one assessment purchase (for "Add package payment") ---------------------------------------

/** The package offer of a purchase the staff member may see, or null (not visible, not ready, or already paid). */
export async function packageOfferFor(purchaseId: string): Promise<PackageOffer | null> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return null;
  const db = await createClient();
  const { data: visible } = await db.from('purchases').select('id').eq('id', purchaseId).maybeSingle();
  if (!visible) return null;
  const { data } = await createAdminClient().rpc('package_offer', { p_purchase: purchaseId });
  const row = ((data ?? []) as PackageOffer[])[0];
  return row ?? null;
}

// --- Manual package payment --------------------------------------------------------------------------------

const MANUAL_MESSAGES = [
  'Only coordinators and super admins can add a package payment.',
  'This purchase was not found.',
  "Only this client's coordinator can add their package payment.",
  'A package is already paid for this purchase.',
  'A package payment can be added after the report presentation is done.',
  'Choose how the client paid.',
  'Enter the reference ID (UPI transaction ID, bank UTR or other).',
  'The note can be at most 500 characters.',
  'The payment date cannot be in the future.',
  'Add the payment proof (screenshot or PDF).',
];

/** Other payments (assessment or package) with the same reference. For a warning only. */
export async function packageReferenceUses(raw: string): Promise<number> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return 0;
  const reference = cleanReference(raw);
  if (!reference) return 0;
  const admin = createAdminClient();
  const exact = /[*%_\\]/.test(reference);
  const [a, b] = await Promise.all(
    (['payments', 'package_payments'] as const).map((table) => {
      const q = admin.from(table).select('id', { count: 'exact', head: true });
      return exact ? q.eq('reference', reference) : q.ilike('reference', reference);
    })
  );
  return (a.count ?? 0) + (b.count ?? 0);
}

export type RecordPackageResult = { ok: true; paymentId: string; duplicateReference: boolean; refundNeeded: boolean } | { ok: false; error: string };

/**
 * "Add package payment": the same form and order as the ₹3,500 manual payment. 1. role, fields and the offer;
 * 2. the proof goes to the SAME Google Drive folder first (if that fails nothing is saved); 3. the database saves
 * the paid payment with the amount it calculates, makes the Package purchase and closes the Package call.
 */
export async function recordPackagePayment(purchaseId: string, form: FormData): Promise<RecordPackageResult> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { ok: false, error: MANUAL_MESSAGES[0] };

  // The assessment field of the shared check is not used here (the purchase fixes it).
  const parsed = parseOfflinePayment({
    code: 'PACKAGE',
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

  if (!(await packageOfferFor(purchaseId))) {
    return { ok: false, error: 'A package payment cannot be added for this purchase now (not ready, or already paid).' };
  }
  if (!isProofStorageConfigured()) {
    console.error('Package payment blocked: proof storage env missing or invalid.');
    return { ok: false, error: STORAGE_NOT_SET_UP };
  }
  const duplicateReference = (await packageReferenceUses(input.reference)) > 0;

  // 2. Proof first: no proof, no payment.
  const paymentId = randomUUID();
  let uploaded: { fileId: string; webViewLink: string };
  try {
    uploaded = await uploadProof(bytes!, paymentId);
  } catch (err) {
    console.error(`Package payment ${paymentId}: proof upload failed:`, err instanceof Error ? err.message : err);
    return { ok: false, error: err instanceof ProofStorageNotConfiguredError ? STORAGE_NOT_SET_UP : PROOF_UPLOAD_FAILED };
  }

  // 3. The paid package payment (the database fixes the amount).
  const { data, error } = await createAdminClient().rpc('package_payment_manual', {
    p_id: paymentId,
    p_purchase: purchaseId,
    p_by: profile.id,
    p_method: input.method,
    p_reference: input.reference,
    p_note: input.note,
    p_paid_at: input.paidAt,
    p_proof_file_id: uploaded.fileId,
    p_proof_url: uploaded.webViewLink,
  });
  if (error) {
    const known = MANUAL_MESSAGES.find((m) => error.message.includes(m));
    console.error(`Package payment ${paymentId} not saved (proof kept in Drive, file ${uploaded.fileId}):`, error.message);
    return { ok: false, error: known ?? 'The payment could not be saved. Please try again.' };
  }
  return { ok: true, paymentId, duplicateReference, refundNeeded: data === 'duplicate' };
}

// --- Lists -------------------------------------------------------------------------------------------------

export interface PackagePaymentRow {
  id: string;
  purchase_id: string;
  client_name: string | null;
  phone: string;
  coordinator_name: string | null;
  package_name: string;
  sessions: number;
  amount_paise: number;
  provider: 'razorpay' | 'offline';
  status: 'created' | 'paid' | 'failed';
  refund_status: 'needed' | 'refunded' | null;
  method: string | null;
  reference: string | null;
  provider_payment_id: string | null;
  proof_url: string | null;
  recorded_by_name: string | null;
  accounts_check: 'pending' | 'checked' | null;
  paid_at: string | null;
  created_at: string;
}

export const PACKAGE_PAYMENTS_PAGE_SIZE = 50;

type One<T> = T | T[] | null;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Package payments, newest first. RLS decides: super admins see all, a coordinator only those of their own
 * clients, counsellors none.
 */
export async function listPackagePayments(page: number): Promise<{ rows: PackagePaymentRow[]; total: number }> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { rows: [], total: 0 };
  const db = await createClient();
  const from = (page - 1) * PACKAGE_PAYMENTS_PAGE_SIZE;
  const { data, error, count } = await db
    .from('package_payments')
    .select(
      'id, purchase_id, phone, client_id, package_name, sessions, amount_paise, provider, status, refund_status, method, reference, provider_payment_id, proof_url, recorded_by_name, accounts_check, paid_at, created_at, purchases!package_payments_purchase_id_fkey(coordinator_id)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, from + PACKAGE_PAYMENTS_PAGE_SIZE - 1);
  if (error) {
    if (error.code === '42P01') return { rows: [], total: 0 };
    throw new Error(`Could not read package payments: ${error.message}`);
  }
  type Raw = Omit<PackagePaymentRow, 'client_name' | 'coordinator_name'> & { client_id: string | null; purchases: One<{ coordinator_id: string | null }> };
  const raw = (data ?? []) as unknown as Raw[];
  const names = await nameLookup(db, raw.map((r) => ({ client_id: r.client_id, phone: r.phone, coordinator_id: one(r.purchases)?.coordinator_id ?? null })));
  return {
    total: count ?? 0,
    rows: raw.map(({ client_id, purchases, ...r }) => ({
      ...r,
      client_name: names.client({ client_id, phone: r.phone }),
      coordinator_name: names.coordinator(one(purchases)?.coordinator_id ?? null),
    })),
  };
}

export interface PackagePurchaseRow {
  id: string;
  parent_purchase_id: string;
  client_name: string | null;
  phone: string;
  coordinator_name: string | null;
  amount_paise: number;
  status: string;
  source: 'pay_page' | 'manual';
  paid_at: string | null;
  package_name: string | null;
  sessions: number | null;
}

/** Package purchases (super admins only: they belong to the future CRM role, not to the coordinators' screen). */
export async function listPackagePurchases(): Promise<PackagePurchaseRow[]> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return [];
  const db = await createClient();
  const { data, error } = await db
    .from('purchases')
    .select('id, parent_purchase_id, phone, client_id, coordinator_id, amount_paise, status, source, paid_at')
    .eq('kind', 'package')
    .order('paid_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Could not read package purchases: ${error.message}`);
  type Raw = Omit<PackagePurchaseRow, 'client_name' | 'coordinator_name' | 'package_name' | 'sessions'> & { client_id: string | null; coordinator_id: string | null };
  const raw = (data ?? []) as unknown as Raw[];
  const [names, { data: pays }] = await Promise.all([
    nameLookup(db, raw),
    raw.length
      ? db.from('package_payments').select('package_purchase_id, package_name, sessions').in('package_purchase_id', raw.map((r) => r.id))
      : Promise.resolve({ data: [] }),
  ]);
  const pkg = new Map(((pays ?? []) as { package_purchase_id: string; package_name: string; sessions: number }[]).map((p) => [p.package_purchase_id, p]));
  return raw.map(({ client_id, coordinator_id, ...r }) => ({
    ...r,
    client_name: names.client({ client_id, phone: r.phone }),
    coordinator_name: names.coordinator(coordinator_id),
    package_name: pkg.get(r.id)?.package_name ?? null,
    sessions: pkg.get(r.id)?.sessions ?? null,
  }));
}
