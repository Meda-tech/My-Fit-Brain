import { requireStaff } from '../../../lib/auth';
import {
  PAYMENT_PERIODS,
  PAYMENT_LISTS,
  PAYMENT_METHOD_FILTERS,
  canViewPayments,
  cleanDate,
  exportPayments,
  type PaymentListRow,
  type PaymentPeriod,
  type PaymentList,
  type PaymentMethodFilter,
} from '../../../lib/services/payments';
import { buildXlsx, type XlsxCell } from '../../../lib/xlsx';
import { paymentSummaryFields } from '../../../lib/payment-fields';
import { formatDateTime, paymentMethodLabel, paymentReference } from '../../../components/payments/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The Payments list (Razorpay and offline) as an Excel file for the calling and accounts teams: one
// stage (or all) and a period, chosen in the Export dialog, plus the method and dates on screen. Super admins and coordinators only. Built on request; nothing is stored.

const COLUMNS: { header: string; width: number; value: (p: PaymentListRow) => XlsxCell }[] = [
  // The first five are shared with the Google Sheets sync (lib/payment-fields.ts).
  { header: 'Status', width: 22, value: (p) => paymentSummaryFields(p).status },
  { header: 'Payment', width: 15, value: (p) => paymentSummaryFields(p).payment },
  { header: 'Assessment', width: 15, value: (p) => paymentSummaryFields(p).assessment },
  { header: 'Name', width: 24, value: (p) => paymentSummaryFields(p).name },
  { header: 'Mobile (paid for)', width: 17, value: (p) => paymentSummaryFields(p).mobile },
  { header: 'Email', width: 28, value: (p) => (p.client ?? p.registered)?.email ?? '' },
  { header: 'Gender', width: 10, value: (p) => (p.client ?? p.registered)?.gender ?? '' },
  { header: 'Age', width: 6, value: (p) => (p.client ?? p.registered)?.age ?? p.age_stop?.age ?? null },
  { header: 'City', width: 14, value: (p) => (p.client ?? p.registered)?.city ?? '' },
  { header: 'State', width: 14, value: (p) => (p.client ?? p.registered)?.state ?? '' },
  { header: 'Assessment name', width: 26, value: (p) => p.test_name },
  { header: 'Report ID', width: 18, value: (p) => p.attempt?.report_id ?? '' },
  { header: 'Amount (₹)', width: 11, value: (p) => p.amount_paise / 100 },
  { header: 'Method', width: 18, value: (p) => paymentMethodLabel(p) },
  { header: 'Reference', width: 24, value: (p) => paymentReference(p) },
  { header: 'Proof', width: 40, value: (p) => p.proof_url ?? '' },
  { header: 'Recorded by', width: 20, value: (p) => p.recorded_by_name ?? '' },
  { header: 'Note', width: 30, value: (p) => p.note ?? '' },
  { header: 'Created (checkout opened / recorded)', width: 20, value: (p) => formatDateTime(p.created_at) },
  { header: 'Paid at', width: 20, value: (p) => (p.paid_at ? formatDateTime(p.paid_at) : '') },
  { header: 'Logged in at', width: 20, value: (p) => (p.claimed_at ? formatDateTime(p.claimed_at) : '') },
  { header: 'Assessment started', width: 20, value: (p) => (p.attempt?.started_at ? formatDateTime(p.attempt.started_at) : '') },
  { header: 'Assessment completed', width: 20, value: (p) => (p.attempt?.completed_at ? formatDateTime(p.attempt.completed_at) : '') },
  { header: 'Paid later', width: 10, value: (p) => (p.paid_later ? 'Yes' : '') },
  { header: 'Why the payment failed', width: 30, value: (p) => p.failure_reason ?? '' },
  { header: 'Cancelled at', width: 20, value: (p) => (p.cancelled_at ? formatDateTime(p.cancelled_at) : '') },
  { header: 'Cancelled by', width: 20, value: (p) => p.cancelled_by_name ?? '' },
  { header: 'Cancel reason', width: 30, value: (p) => p.cancel_reason ?? '' },
  { header: 'Razorpay payment ID', width: 22, value: (p) => (p.provider === 'razorpay' ? (p.provider_payment_id ?? '') : '') },
  { header: 'Razorpay order ID', width: 24, value: (p) => (p.provider === 'razorpay' ? p.provider_order_id : '') },
  { header: 'Our reference', width: 38, value: (p) => p.id },
];

export async function GET(request: Request) {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return new Response('Not allowed', { status: 403 });

  const sp = new URL(request.url).searchParams;
  const status = (PAYMENT_LISTS as string[]).includes(sp.get('status') ?? '') ? (sp.get('status') as PaymentList) : 'all';
  const period = PAYMENT_PERIODS.some((p) => p.id === sp.get('period')) ? (sp.get('period') as PaymentPeriod) : 'all';
  const method = PAYMENT_METHOD_FILTERS.some((m) => m.id === sp.get('method')) ? (sp.get('method') as PaymentMethodFilter | 'all') : 'all';
  const from = cleanDate(sp.get('from'));
  const to = cleanDate(sp.get('to'));

  let rows: PaymentListRow[];
  try {
    rows = await exportPayments({ status, period, method, from, to, q: '' });
  } catch (err) {
    console.error('Payments export failed:', err);
    return new Response('The export could not be prepared.', { status: 500 });
  }

  const file = buildXlsx({
    name: 'Payments',
    columns: COLUMNS.map(({ header, width }) => ({ header, width })),
    rows: rows.map((p) => COLUMNS.map((c) => c.value(p))),
  });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const name = `payments-${status.replace(/_/g, '-')}-${period}${method !== 'all' ? `-${method.replace(/_/g, '-')}` : ''}${from || to ? `-${from || 'start'}-to-${to || 'today'}` : ''}-${today}.xlsx`;

  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
