'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '../brand';

// Downloads the report PDF (built on request by /attempts/[id]/pdf, never stored). The file name is
// the report ID (CLAUDE.md: PDF file name = ID only).
export function DownloadPdfButton({ attemptId, reportId }: { attemptId: string; reportId: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/attempts/${attemptId}/pdf`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 print:hidden">
      {failed && <span className="text-[14px] text-coral-deep">Could not prepare the PDF. Please try again.</span>}
      <Button variant="secondary" onClick={download} loading={busy} loadingText="Preparing PDF...">
        <Download size={18} strokeWidth={2} aria-hidden />
        <span>Download PDF</span>
      </Button>
    </div>
  );
}
