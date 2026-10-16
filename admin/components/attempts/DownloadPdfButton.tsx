'use client';

import { Download } from 'lucide-react';
import { Button } from '../brand';

// Downloads the report as a PDF through the browser's print dialog ("Save as PDF"). Nothing is
// generated or stored on the server. The suggested file name is the report ID (CLAUDE.md: PDF file
// name = ID only); the tab title goes back to the generic one afterwards.
export function DownloadPdfButton({ reportId }: { reportId: string }) {
  const download = () => {
    const title = document.title;
    const restore = () => {
      document.title = title;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    document.title = reportId;
    window.print();
  };

  return (
    <Button variant="secondary" onClick={download} className="print:hidden">
      <Download size={18} strokeWidth={2} aria-hidden />
      <span>Download PDF</span>
    </Button>
  );
}
