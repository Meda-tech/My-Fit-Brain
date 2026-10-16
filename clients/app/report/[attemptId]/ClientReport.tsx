'use client';

import { ReportView, type ReportDocument } from '@mfb/report';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import { Logo } from '../../../components/brand';

const LABELS = {
  en: { reportId: translations.en.assess.reportId, date: translations.en.assess.date },
  hi: { reportId: translations.hi.assess.reportId, date: translations.hi.assess.date },
};

// The report follows the EN | हिं toggle. Reports are stored in both languages (D21); an older report
// stored in one language shows that language whatever the toggle says.
export function ClientReport({ doc }: { doc: ReportDocument }) {
  const { lang } = useLanguage();
  return (
    <ReportView
      doc={doc}
      lang={lang}
      logo={<Logo variant="endorsed" tone="colour" width={220} />}
      seal={<Logo variant="seal" tone="colour" width={96} />}
      labels={LABELS}
    />
  );
}
