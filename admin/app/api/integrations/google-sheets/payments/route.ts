import { createAdminClient } from '../../../../../lib/supabase/admin';
import { SYNC_LIMIT, TooManyRowsError, readPaymentsForSync } from '../../../../../lib/services/payments';
import { paymentSummaryFields } from '../../../../../lib/payment-fields';
import { isAuthorized, parseRange } from '../../../../../lib/integrations/sheets-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only feed for the Google Sheets sync: status, payment, assessment, name and mobile per
// purchase, the same values as the Excel export. Bearer token in GOOGLE_SHEETS_SYNC_TOKEN (64
// characters), checked before anything is read. Optional ?from= (inclusive) and ?to= (exclusive):
// purchases whose shown values may have changed in that window (see readPaymentsForSync).

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: HEADERS });
}

export async function GET(request: Request) {
  if (!isAuthorized(request.headers.get('authorization'))) return json({ error: 'Unauthorized' }, 401);

  const range = parseRange(new URL(request.url).searchParams);
  if (!range.ok) return json({ error: range.error }, 400);

  try {
    const rows = await readPaymentsForSync(createAdminClient(), { from: range.from, to: range.to });
    const data = rows.map(paymentSummaryFields);
    return json({ success: true, count: data.length, data });
  } catch (err) {
    if (err instanceof TooManyRowsError) {
      return json({ error: `More than ${SYNC_LIMIT} records. Use a shorter from / to range.` }, 422);
    }
    // Details stay in the server logs (Vercel → project → Logs), never in the response.
    console.error('Google Sheets payments sync failed:', err);
    return json({ error: 'Could not read payments. Please try again.' }, 500);
  }
}
