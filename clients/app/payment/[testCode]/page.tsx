import { notFound } from 'next/navigation';
import { currentClient, testName } from '../../../lib/assessment/server';
import { paymentsMode } from '../../../lib/assessment/payments';
import { PageChrome } from '../../../components/PageChrome';
import { PaymentView } from './PaymentView';

export const dynamic = 'force-dynamic';

export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ testCode: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await currentClient();
  const { testCode } = await params;
  const { error } = await searchParams;
  const name = await testName(testCode);
  if (!name) notFound();

  return (
    <PageChrome>
      <PaymentView testCode={testCode} name={name} stub={paymentsMode() === 'stub'} error={error ?? null} />
    </PageChrome>
  );
}
