import { NextResponse, type NextRequest } from 'next/server';
import { currentClient, forgetAttempt, serviceDeps } from '../../../../lib/assessment/server';
import { saveDraft } from '../../../../lib/assessment/service';

// Saves the answers buffered in the browser. Called with fetch(..., { keepalive: true }) when the
// assessment tab is hidden or closed, so a client who leaves mid-way can resume where they stopped.
export async function POST(request: NextRequest) {
  let body: { attemptId?: unknown; answers?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof body.attemptId !== 'string') return NextResponse.json({ ok: false }, { status: 400 });
  const client = await currentClient();
  try {
    const saved = await saveDraft(serviceDeps({ cached: true }), client, body.attemptId, body.answers);
    return NextResponse.json({ ok: true, saved });
  } catch {
    forgetAttempt(body.attemptId);
    return NextResponse.json({ ok: false }, { status: 409 });
  }
}
