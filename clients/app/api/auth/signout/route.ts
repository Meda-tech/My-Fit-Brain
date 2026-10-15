import { createClient } from '../../../../lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Relative Location so the browser stays on the host it used (LAN IP or
  // domain). request.url resolves to localhost in dev. 303 turns the POST into a GET.
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
