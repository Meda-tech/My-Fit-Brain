import 'server-only';
import { randomUUID } from 'node:crypto';
import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import { ProofStorageNotConfiguredError, isProofStorageConfigured, uploadProof } from '../google/drive';
import { ASSESSMENT_PRICE_PAISE, cleanReference, parseOfflinePayment, proofProblem } from '../offline-payments';
import {
  parsePackageAmount,
  parsePackageAmounts,
  parsePackageSettings,
  readMilestones,
  type PackageBalance,
  type PackageSettings,
} from '../package';
import { PROOF_UPLOAD_FAILED, STORAGE_NOT_SET_UP } from './offline-payments';
import { canViewPurchases, nameLookup } from './purchases';

// Package (step 6; part payments and CRM since 2026-11-24): settings (super admins), the manual package payment and
// the lists. A package can be paid in parts: coordinators add payments for their own clients until the package
// starts (paid in total reaches the start amount); after that the client's CRM does; super admins always. The
// database fixes the package amount, checks every amount and every rule again, and decides when a package starts.

/** Who may add a package payment at all (the database decides for which client and when). */
export const PACKAGE_PAYMENT_ROLES = ['super_admin', 'coordinator', 'crm'] as const;
export function canAddPackagePayments(role: string): boolean {
  return (PACKAGE_PAYMENT_ROLES as readonly string[]).includes(role);
}

// --- Settings ----------------------------------------------------------------------------------------------

export async function getPackage(): Promise<PackageSettings | null> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return null;
  const db = await createClient();
  const { data } = await db
    .from('packages')
    .select('name, sessions, frequency, price_paise, first_min_paise, start_paise, milestones, updated_at')
    .eq('is_active', true)
    .maybeSingle();
  if (!data) return null;
  const row = data as Omit<PackageSettings, 'milestones'> & { milestones: unknown };
  return { ...row, milestones: readMilestones(row.milestones) };
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

const AMOUNT_MESSAGES = [
  'Only super admins can change the package.',
  'The package is not set up yet.',
  'Enter the first payment minimum in whole rupees.',
  'The start amount must be between the first payment minimum and the package amount.',
  'Enter the milestones.',
  'Each milestone needs a session number and an amount in whole rupees.',
  'Milestone sessions must go up, from 1 to the number of sessions.',
  'Milestone amounts must go up and never be more than the package amount.',
];

/** Package amounts (super admins): first payment minimum, start amount, milestones. Typed in rupees. */
export async function savePackageAmounts(fields: {
  firstMin: unknown;
  start: unknown;
  milestones: { session: unknown; amount: unknown }[];
}): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return { success: false, error: AMOUNT_MESSAGES[0] };
  const current = await getPackage();
  if (!current) return { success: false, error: AMOUNT_MESSAGES[1] };
  const parsed = parsePackageAmounts(fields, { totalPaise: current.price_paise - ASSESSMENT_PRICE_PAISE, sessions: current.sessions });
  if (!parsed.ok) return { success: false, error: parsed.error };
  const { error } = await createAdminClient().rpc('package_amounts_save', {
    p_by: profile.id,
    p_first_min_paise: parsed.value.first_min_paise,
    p_start_paise: parsed.value.start_paise,
    p_milestones: parsed.value.milestones,
  });
  if (error) {
    const known = AMOUNT_MESSAGES.find((m) => error.message.includes(m));
    if (!known) console.error('package_amounts_save failed:', error.message);
    return { success: false, error: known ?? 'The package amounts could not be saved. Please try again.' };
  }
  return { success: true };
}

// --- The balance of one assessment purchase (for "Add package payment") --------------------------------------

/**
 * The package balance of a purchase, or null when this staff member cannot add a payment for it now: not visible,
 * the report presentation is not done yet, or (for a coordinator) the package has started and is with CRM.
 * A CRM gets it only for a started package of their own client.
 */
export async function packageBalanceFor(purchaseId: string): Promise<PackageBalance | null> {
  const { profile } = await requireStaff();
  if (!canAddPackagePayments(profile.role)) return null;
  const admin = createAdminClient();
  if (profile.role === 'crm') {
    const { data: own } = await admin
      .from('purchases')
      .select('id')
      .eq('parent_purchase_id', purchaseId)
      .eq('kind', 'package')
      .eq('status', 'paid')
      .eq('crm_id', profile.id)
      .maybeSingle();
    if (!own) return null;
  } else {
    // RLS: a coordinator reads only the purchases of their own clients.
    const db = await createClient();
    const { data: visible } = await db.from('purchases').select('id').eq('id', purchaseId).eq('kind', 'assessment').maybeSingle();
    if (!visible) return null;
  }
  const { data, error } = await admin.rpc('package_balance', { p_purchase: purchaseId });
  if (error) {
    console.error('package_balance failed:', error.message);
    return null;
  }
  const row = ((data ?? []) as PackageBalance[])[0] ?? null;
  if (!row) return null;
  if (profile.role === 'coordinator' && row.started) return null;
  return row;
}

// --- Manual package payment --------------------------------------------------------------------------------

const MANUAL_MESSAGES = [
  'Only coordinators, CRM and super admins can add a package payment.',
  'This purchase was not found.',
  "Only this client's coordinator can add their package payment.",
  "Only this client's CRM can add their package payment.",
  'A package payment can be added after the report presentation is done.',
  'This package has started and is with CRM now.',
  'This package is already paid in full.',
  'Enter the amount in whole rupees.',
  'Choose how the client paid.',
  'Enter the reference ID (UPI transaction ID, bank UTR or other).',
  'The note can be at most 500 characters.',
  'The payment date cannot be in the future.',
  'Add the payment proof (screenshot or PDF).',
];
/** Database messages that carry an amount: shown as they are. */
const AMOUNT_REFUSALS = /(The amount is more than the remaining balance \(₹[\d,]+\)\.|The first payment must be at least ₹[\d,]+\.)/;

/** Other payments (assessment or package) with the same reference. For a warning only. */
export async function packageReferenceUses(raw: string): Promise<number> {
  const { profile } = await requireStaff();
  if (!canAddPackagePayments(profile.role)) return 0;
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

export type RecordPackageResult =
  | { ok: true; paymentId: string; duplicateReference: boolean; refundNeeded: boolean }
  | { ok: false; error: string };

/**
 * "Add package payment": the same form and order as the ₹3,500 manual payment, with an amount (a part payment is
 * allowed). 1. role, fields, the balance and the amount (first payment at least the first minimum, never more than
 * the remaining balance); 2. the proof goes to the SAME Google Drive folder first (if that fails nothing is saved);
 * 3. the database checks everything again, saves the paid payment and counts it: below the start amount the Package
 * call stays open; at the start amount the Package purchase is made and handed over to CRM.
 */
export async function recordPackagePayment(purchaseId: string, form: FormData): Promise<RecordPackageResult> {
  const { profile } = await requireStaff();
  if (!canAddPackagePayments(profile.role)) return { ok: false, error: MANUAL_MESSAGES[0] };

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

  const balance = await packageBalanceFor(purchaseId);
  if (!balance) {
    return { ok: false, error: 'A package payment cannot be added for this purchase now (not ready, or it is with CRM).' };
  }
  const amount = parsePackageAmount(form.get('amount'), balance);
  if (!amount.ok) return amount;

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

  // 3. The paid package payment (the database checks the amount again and counts it).
  const { data, error } = await createAdminClient().rpc('package_payment_add', {
    p_id: paymentId,
    p_purchase: purchaseId,
    p_by: profile.id,
    p_amount: amount.paise,
    p_method: input.method,
    p_reference: input.reference,
    p_note: input.note,
    p_paid_at: input.paidAt,
    p_proof_file_id: uploaded.fileId,
    p_proof_url: uploaded.webViewLink,
  });
  if (error) {
    const known = MANUAL_MESSAGES.find((m) => error.message.includes(m)) ?? error.message.match(AMOUNT_REFUSALS)?.[1];
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
 * Package payments, newest first. RLS decides: super admins see all; a coordinator only those of their own clients
 * made up to the handover to CRM; counsellors none.
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
  /** The whole package amount. */
  amount_paise: number;
  /** Paid so far (the payments that count). */
  paid_paise: number;
  status: string;
  source: 'pay_page' | 'manual';
  /** When the package started (paid in total reached the start amount). */
  paid_at: string | null;
  package_name: string | null;
  sessions: number | null;
}

/** Package purchases (super admins only here; the CRM page is where they are worked on). */
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
  type Raw = Omit<PackagePurchaseRow, 'client_name' | 'coordinator_name' | 'package_name' | 'sessions' | 'paid_paise'> & { client_id: string | null; coordinator_id: string | null };
  const raw = (data ?? []) as unknown as Raw[];
  const [names, { data: pays }] = await Promise.all([
    nameLookup(db, raw),
    raw.length
      ? db
          .from('package_payments')
          .select('package_purchase_id, package_name, sessions, amount_paise, status, refund_status')
          .in('package_purchase_id', raw.map((r) => r.id))
      : Promise.resolve({ data: [] }),
  ]);
  type Pay = { package_purchase_id: string; package_name: string; sessions: number; amount_paise: number; status: string; refund_status: string | null };
  const pkg = new Map<string, { package_name: string; sessions: number; paid: number }>();
  for (const p of (pays ?? []) as Pay[]) {
    const seen = pkg.get(p.package_purchase_id) ?? { package_name: p.package_name, sessions: p.sessions, paid: 0 };
    if (p.status === 'paid' && !p.refund_status) seen.paid += p.amount_paise;
    pkg.set(p.package_purchase_id, seen);
  }
  return raw.map(({ client_id, coordinator_id, ...r }) => ({
    ...r,
    client_name: names.client({ client_id, phone: r.phone }),
    coordinator_name: names.coordinator(coordinator_id),
    package_name: pkg.get(r.id)?.package_name ?? null,
    sessions: pkg.get(r.id)?.sessions ?? null,
    paid_paise: pkg.get(r.id)?.paid ?? 0,
  }));
}
