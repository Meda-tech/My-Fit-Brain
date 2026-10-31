import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { PUBLIC_PATHS } from './lib/legal';

// Next.js 16 "proxy" (formerly middleware): refreshes the Supabase session on each request.
// The policy pages and the pay links (/pay/<code>: pay first, log in later) are public (no sign-in), so
// they skip the session check entirely.
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.includes(path) || path.startsWith('/pay/')) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
