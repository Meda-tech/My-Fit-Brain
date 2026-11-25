import 'server-only';
import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import { readMilestones, type Milestone, type PackagePayment } from '../package';

// The CRM page (owner, 2026-11-24): the Package purchases that have started. A CRM sees only their own clients',
// super admins all. Everything is read with the signed-in staff member's own session, so the DATABASE decides:
//   * crm_packages() returns only what CRM needs (client name, phone, package, started on, paid so far, remaining,
//     next milestone) for the rows the caller may see; it is the only way a CRM login reads a client's name;
//   * package_payments: a CRM reads the payments of their own clients' packages (RLS).
// A CRM login reads no assessment, answer, report, conclusion or safety alert anywhere (RESTRICTIVE rules).

export const CRM_ROLES = ['super_admin', 'crm'] as const;
export function canViewCrm(role: string): boolean {
  return (CRM_ROLES as readonly string[]).includes(role);
}

export interface CrmPackageRow {
  /** The Package purchase. */
  id: string;
  /** Its assessment purchase (package payments are added against it). */
  parent_purchase_id: string;
  client_name: string | null;
  phone: string;
  crm_id: string | null;
  crm_name: string | null;
  package_name: string | null;
  sessions: number | null;
  frequency: string | null;
  started_at: string | null;
  total_paise: number;
  paid_paise: number;
  remaining_paise: number;
  /** The next milestone; both empty when the package is paid in full. next_session empty = "in full". */
  next_session: number | null;
  next_paid_paise: number | null;
  milestones: Milestone[];
}

/** The Package purchases this staff member may see, newest first. */
export async function listCrmPackages(): Promise<CrmPackageRow[]> {
  const { profile } = await requireStaff();
  if (!canViewCrm(profile.role)) return [];
  const db = await createClient();
  const { data, error } = await db.rpc('crm_packages');
  if (error) {
    // Before the migration 20261124000000 the function does not exist: an empty page.
    if (error.code === '42883' || error.code === 'PGRST202') return [];
    throw new Error(`Could not read packages: ${error.message}`);
  }
  return ((data ?? []) as (Omit<CrmPackageRow, 'milestones'> & { milestones: unknown })[]).map((r) => ({ ...r, milestones: readMilestones(r.milestones) }));
}

/** CRM staff, for the super admin's filter. */
export async function listCrmStaff(): Promise<{ id: string; full_name: string }[]> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return [];
  const { data } = await createAdminClient().from('profiles').select('id, full_name').eq('role', 'crm').order('full_name');
  return (data ?? []) as { id: string; full_name: string }[];
}

/**
 * The paid package payments of one package, oldest first, with their proof links. RLS: a CRM reads only the payments
 * that belong to their own clients' packages; super admins also see a payment kept apart for a refund.
 */
export async function crmPackagePayments(parentPurchaseId: string): Promise<PackagePayment[]> {
  const { profile } = await requireStaff();
  if (!canViewCrm(profile.role)) return [];
  const db = await createClient();
  const { data, error } = await db
    .from('package_payments')
    .select('id, amount_paise, paid_at, provider, method, reference, proof_url, recorded_by_name, accounts_check, refund_status, after_handover')
    .eq('purchase_id', parentPurchaseId)
    .eq('status', 'paid')
    .order('paid_at');
  if (error) throw new Error(`Could not read package payments: ${error.message}`);
  type Raw = Omit<PackagePayment, 'refund_needed'> & { refund_status: string | null };
  return ((data ?? []) as unknown as Raw[]).map(({ refund_status, ...p }) => ({ ...p, refund_needed: !!refund_status }));
}
