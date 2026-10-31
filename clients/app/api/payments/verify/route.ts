import { NextResponse, type NextRequest } from 'next/server';
import { maskPhoneNumber } from '../../../../lib/phone';
import { paymentDeps, signedInBuyer } from '../../../../lib/payments/server';
import { claimPurchases, confirmCheckout, PaymentError } from '../../../../lib/payments/service';

// Step 3: the checkout success callback. No sign-in needed: the checkout signature proves the result
// came from Razorpay for this order, and the server checks the payment with Razorpay before marking it
// paid. A signed-in client whose number it is goes straight Home; everyone else logs in with the number.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  try {
    const deps = paymentDeps();
    const payment = await confirmCheckout(deps, { orderId, paymentId, signature });
    const buyer = await signedInBuyer();
    if (buyer) {
      await claimPurchases(deps, buyer.client, buyer.phone);
      if (payment.client_id === buyer.client.id || payment.phone === buyer.phone) {
        return NextResponse.json({ ok: true, next: 'home' });
      }
    }
    return NextResponse.json({ ok: true, next: 'login', phone: maskPhoneNumber(payment.phone) });
  } catch (err) {
    if (err instanceof PaymentError) {
      const status = err.code === 'PENDING' ? 202 : err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ ok: false, code: err.code }, { status });
    }
    console.error('Payment verification failed:', err);
    return NextResponse.json({ ok: false, code: 'ERROR' }, { status: 502 });
  }
}
