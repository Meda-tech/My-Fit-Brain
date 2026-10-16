import { createElement } from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { requireStaff } from '../../../../lib/auth';
import { canViewReports, getAttemptDetail } from '../../../../lib/services/attempts';
import { ReportPdf } from '../../../../lib/report-pdf/ReportPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The report as a PDF, generated on request for super admins and counsellors (D22) and sent straight
// to the browser. Nothing is stored. File name = report ID.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireStaff();
  if (!canViewReports(profile.role)) return new Response('Not allowed', { status: 403 });

  const { id } = await params;
  const detail = await getAttemptDetail(id);
  if (!detail?.report) return new Response('Report not found', { status: 404 });

  const element = createElement(ReportPdf, {
    doc: detail.report,
    clientName: detail.clientName ?? 'Client',
    testName: detail.attempt.test_name,
  }) as unknown as ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(element);

  const fileName = `${detail.attempt.report_id}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
