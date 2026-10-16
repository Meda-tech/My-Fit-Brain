import { NextResponse, type NextRequest } from 'next/server';
import { apiClient, paymentDeps } from '../../../../lib/payments/server';
import { confirmCheckout, PaymentError } from '../../../../lib/payments/service';

// Step 3: the checkout success callback. The server checks the signature and the payment with
// Razorpay before the assessment is created.
export async function POST(request: NextRequest) {
  const client = await apiClient();
  if (!client) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  try {
    const { attemptId } = await confirmCheckout(paymentDeps(), client, { orderId, paymentId, signature });
    return NextResponse.json({ ok: true, attemptId });
  } catch (err) {
    if (err instanceof PaymentError) {
      const status = err.code === 'PENDING' ? 202 : err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ ok: false, code: err.code }, { status });
    }
    console.error('Payment verification failed:', err);
    return NextResponse.json({ ok: false, code: 'ERROR' }, { status: 502 });
  }
}
