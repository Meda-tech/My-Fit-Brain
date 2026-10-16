import { NextResponse, type NextRequest } from 'next/server';
import { paymentDeps } from '../../../../lib/payments/server';
import { handleWebhook, PaymentError } from '../../../../lib/payments/service';

// Razorpay webhook (Dashboard → Webhooks): URL <clients app>/api/payments/webhook, secret =
// RAZORPAY_WEBHOOK_SECRET, events payment.captured, order.paid, payment.failed. The signature is
// checked over the raw body. A 5xx makes Razorpay retry; processed events are skipped on retry.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature') ?? '';
  const eventId = request.headers.get('x-razorpay-event-id');
  try {
    const outcome = await handleWebhook(paymentDeps(), raw, signature, eventId);
    if (outcome === 'invalid') return NextResponse.json({ ok: false }, { status: 400 });
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    if (err instanceof PaymentError && err.code === 'NOT_CONFIGURED') return NextResponse.json({ ok: false }, { status: 503 });
    console.error('Payment webhook failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
