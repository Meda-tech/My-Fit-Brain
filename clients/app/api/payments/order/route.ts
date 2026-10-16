import { NextResponse, type NextRequest } from 'next/server';
import { AssessmentError } from '../../../../lib/assessment/types';
import { apiClient, paymentDeps } from '../../../../lib/payments/server';
import { createCheckout, PaymentError } from '../../../../lib/payments/service';

// Step 1: create a Razorpay order for the signed-in client. The amount is fixed on the server.
export async function POST(request: NextRequest) {
  const client = await apiClient();
  if (!client) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { testCode?: unknown };
  if (typeof body.testCode !== 'string' || !/^[A-Z]{1,8}$/.test(body.testCode)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  try {
    const checkout = await createCheckout(paymentDeps(), client, body.testCode);
    return NextResponse.json({ ok: true, ...checkout });
  } catch (err) {
    if (err instanceof PaymentError || err instanceof AssessmentError) {
      return NextResponse.json({ ok: false, code: err.code }, { status: err.code === 'NOT_CONFIGURED' ? 503 : 409 });
    }
    console.error('Payment order failed:', err);
    return NextResponse.json({ ok: false, code: 'ERROR' }, { status: 502 });
  }
}
