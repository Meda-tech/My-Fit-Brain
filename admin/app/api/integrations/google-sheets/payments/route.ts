import { createAdminClient } from '../../../../../lib/supabase/admin';
import { SYNC_LIMIT, TooManyRowsError, readPaymentsForSync, readTriesForSync } from '../../../../../lib/services/payments';
import { paymentSummaryFields } from '../../../../../lib/payment-fields';
import { isAuthorized, parseRange } from '../../../../../lib/integrations/sheets-auth';
import { byPaymentTime, indiaTime, latest, replacedTries } from '../../../../../lib/integrations/sheets-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only feed for the Google Sheets sync. Bearer token in GOOGLE_SHEETS_SYNC_TOKEN (64 characters),
// checked before anything is read. Optional ?from= (inclusive) and ?to= (exclusive): purchases whose
// shown values may have changed in that window (see readPaymentsForSync).
//
// One row per purchase, oldest payment first, keyed by purchase_id (the payments row id; never
// changes). status, payment, assessment, name and mobile are the same values as the Excel export.
// An unpaid try followed by a later try for the same number and test is left out of `data`, and its
// id is listed in `removed` so the sheet can delete a row it already has (see sheets-rows.ts).
// Times are India time, "YYYY-MM-DD HH:mm:ss".

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: HEADERS });
}

export async function GET(request: Request) {
  if (!isAuthorized(request.headers.get('authorization'))) return json({ error: 'Unauthorized' }, 401);

  const range = parseRange(new URL(request.url).searchParams);
  if (!range.ok) return json({ error: range.error }, 400);

  try {
    const db = createAdminClient();
    const rows = await readPaymentsForSync(db, { from: range.from, to: range.to });
    const replaced = replacedTries(await readTriesForSync(db, rows.map((p) => p.phone)));

    const data = rows
      .filter((p) => !replaced.has(p.id))
      .map((p) => ({ id: p.id, time: p.paid_at ?? p.created_at, p }))
      .sort(byPaymentTime)
      .map(({ p, time }) => ({
        purchase_id: p.id,
        payment_time: indiaTime(time),
        test: p.test_code,
        ...paymentSummaryFields(p),
        last_update: indiaTime(latest(p.updated_at, p.claimed_at, p.cancelled_at, p.attempt?.started_at, p.attempt?.completed_at)),
      }));
    const removed = [...replaced].sort();
    return json({ success: true, count: data.length, data, removed });
  } catch (err) {
    if (err instanceof TooManyRowsError) {
      return json({ error: `More than ${SYNC_LIMIT} records. Use a shorter from / to range.` }, 422);
    }
    // Details stay in the server logs (Vercel → project → Logs), never in the response.
    console.error('Google Sheets payments sync failed:', err);
    return json({ error: 'Could not read payments. Please try again.' }, 500);
  }
}
