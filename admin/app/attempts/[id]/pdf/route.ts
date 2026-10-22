import { createElement } from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { requireStaff } from '../../../../lib/auth';
import { canViewReports, getAttemptDetail } from '../../../../lib/services/attempts';
import { ReportPdf } from '../../../../lib/report-pdf/ReportPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The report as a PDF, generated on request for super admins and counsellors and sent straight to the
// browser. Nothing is stored. File name = report ID.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireStaff();
  if (!canViewReports(profile.role)) return new Response('Not allowed', { status: 403 });

  const { id } = await params;
  const detail = await getAttemptDetail(id);
  if (!detail?.report) return new Response('Report not found', { status: 404 });

  let pdf: Buffer;
  try {
    const element = createElement(ReportPdf, { report: detail.report }) as unknown as ReactElement<DocumentProps>;
    pdf = await renderToBuffer(element);
  } catch (err) {
    // Shows in the deployment's function logs (Vercel → project → Logs).
    console.error(`Report PDF failed for attempt ${id}:`, err);
    return new Response('The PDF could not be prepared.', { status: 500 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${detail.attempt.report_id}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
