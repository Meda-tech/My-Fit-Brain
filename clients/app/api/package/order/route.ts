import { NextResponse, type NextRequest } from 'next/server';
import { packageDeps } from '../../../../lib/package/server';
import { createPackageCheckout } from '../../../../lib/package/service';
import { signedInBuyer } from '../../../../lib/payments/server';
import { PaymentError } from '../../../../lib/payments/service';

// Package payment, step 1: create a Razorpay order for the signed-in client's own offer. The amount comes
// from the database (package price − assessment amount paid); the browser sends only which purchase.
export async function POST(request: NextRequest) {
  const buyer = await signedInBuyer();
  if (!buyer) return NextResponse.json({ ok: false, code: 'SIGNED_OUT' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { purchaseId?: unknown };
  if (typeof body.purchaseId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.purchaseId)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  try {
    const checkout = await createPackageCheckout(packageDeps(), buyer.client, body.purchaseId);
    return NextResponse.json({ ok: true, ...checkout, contact: buyer.phone });
  } catch (err) {
    if (err instanceof PaymentError) {
      const status = err.code === 'NOT_CONFIGURED' ? 503 : err.code === 'RATE_LIMITED' ? 429 : err.code === 'NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ ok: false, code: err.code }, { status });
    }
    console.error('Package order failed:', err);
    return NextResponse.json({ ok: false, code: 'ERROR' }, { status: 502 });
  }
}
