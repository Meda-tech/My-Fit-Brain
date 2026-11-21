import { NextResponse, type NextRequest } from 'next/server';
import { packageDeps } from '../../../../lib/package/server';
import { confirmPackageCheckout } from '../../../../lib/package/service';
import { signedInBuyer } from '../../../../lib/payments/server';
import { PaymentError } from '../../../../lib/payments/service';

// Package payment, step 3: the checkout success callback. The checkout signature proves the result came from
// Razorpay for this order, and the server checks the payment with Razorpay before marking it paid. "duplicate"
// = a package was already paid for this purchase: this payment is kept apart for a refund.
export async function POST(request: NextRequest) {
  const buyer = await signedInBuyer();
  if (!buyer) return NextResponse.json({ ok: false, code: 'SIGNED_OUT' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  try {
    const result = await confirmPackageCheckout(packageDeps(), buyer.client, { orderId, paymentId, signature });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof PaymentError) {
      const status = err.code === 'PENDING' ? 202 : err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ ok: false, code: err.code }, { status });
    }
    console.error('Package payment verification failed:', err);
    return NextResponse.json({ ok: false, code: 'ERROR' }, { status: 502 });
  }
}
