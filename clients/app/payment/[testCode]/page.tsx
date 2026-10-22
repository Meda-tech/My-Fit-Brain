import { notFound } from 'next/navigation';
import { requireClient } from '../../../lib/auth';
import { questionnaireName } from '../../../lib/assessment/server';
import { paymentsConfigured } from '../../../lib/payments/server';
import { formatPrice } from '../../../lib/payments/service';
import { PageChrome } from '../../../components/PageChrome';
import { PaymentView } from './PaymentView';

export const dynamic = 'force-dynamic';

export default async function PaymentPage({ params }: { params: Promise<{ testCode: string }> }) {
  const { client } = await requireClient();
  const { testCode } = await params;
  const name = await questionnaireName(testCode);
  if (!name) notFound();

  return (
    <PageChrome nav={false}>
      <PaymentView
        testCode={testCode}
        name={name}
        price={formatPrice()}
        enabled={paymentsConfigured()}
        prefill={{ name: client.full_name, email: client.email ?? '', contact: client.phone }}
      />
    </PageChrome>
  );
}
