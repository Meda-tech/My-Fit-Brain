import { NextResponse, type NextRequest } from 'next/server';
import { AssessmentError } from '../../../../lib/assessment/types';
import { ipHash, payQuestionnaire, paymentDeps, signedInBuyer } from '../../../../lib/payments/server';
import { createCheckout, PaymentError } from '../../../../lib/payments/service';

// Step 1: create a Razorpay order. No sign-in needed: the purchase belongs to the phone number. A
// signed-in client always buys for their own verified number. The amount is fixed on the server.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { payCode?: unknown; phone?: unknown };
  if (typeof body.payCode !== 'string' || typeof body.phone !== 'string') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  const questionnaire = await payQuestionnaire(body.payCode);
  if (!questionnaire) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  const buyer = await signedInBuyer();
  try {
    const checkout = await createCheckout(paymentDeps(), {
      code: questionnaire.code,
      phone: buyer?.phone ?? body.phone,
      client: buyer?.client ?? null,
      ipHash: ipHash(request.headers),
    });
    if (checkout.kind === 'owned') return NextResponse.json({ ok: true, kind: 'owned' });
    // The full number stays with the server and the checkout prefill.
    const { kind, keyId, orderId, amount, currency, phone } = checkout;
    return NextResponse.json({ ok: true, kind, keyId, orderId, amount, currency, contact: phone });
  } catch (err) {
    if (err instanceof PaymentError || err instanceof AssessmentError) {
      const status = err.code === 'NOT_CONFIGURED' ? 503 : err.code === 'RATE_LIMITED' ? 429 : err.code === 'BAD_PHONE' ? 400 : 409;
      return NextResponse.json({ ok: false, code: err.code }, { status });
    }
    console.error('Payment order failed:', err);
    return NextResponse.json({ ok: false, code: 'ERROR' }, { status: 502 });
  }
}
