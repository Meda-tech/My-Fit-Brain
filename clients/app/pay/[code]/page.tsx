import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { payQuestionnaire, paymentsConfigured, signedInBuyer } from '../../../lib/payments/server';
import { REGULAR_PRICE_PAISE, formatPrice } from '../../../lib/payments/service';
import { PageChrome } from '../../../components/PageChrome';
import { Footer } from '../../../components/brand';
import { PayView } from './PayView';

// Public pay link /pay/<questionnaire code>, e.g. /pay/IA (pay first, log in later). The link preview
// and the tab title never name the test (discretion rule).

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Fit Brain',
  openGraph: { title: 'My Fit Brain', siteName: 'My Fit Brain' },
  twitter: { title: 'My Fit Brain' },
};

export default async function PayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [questionnaire, buyer] = await Promise.all([payQuestionnaire(code), signedInBuyer()]);
  if (!questionnaire) notFound();

  return (
    <PageChrome nav={false}>
      <PayView
        code={questionnaire.code}
        name={questionnaire.name}
        subtitle={questionnaire.subtitle}
        price={formatPrice()}
        regularPrice={formatPrice(REGULAR_PRICE_PAISE)}
        enabled={paymentsConfigured()}
        paused={!questionnaire.active}
        signedInPhone={buyer?.phone ?? null}
        prefill={buyer ? { name: buyer.client.full_name } : null}
      />
      <Footer bordered={false} className="mt-6" />
    </PageChrome>
  );
}
