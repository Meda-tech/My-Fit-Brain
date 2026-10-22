import { requireClient } from '../lib/auth';
import { homeData } from '../lib/assessment/server';
import { ClientHomeView } from './ClientHomeView';

export const dynamic = 'force-dynamic';

export default async function ClientHomePage() {
  const { client } = await requireClient();
  const { tests, attempts } = await homeData({ id: client.id, full_name: client.full_name });
  const firstName = client.full_name.trim().split(/\s+/)[0] || client.full_name;

  return <ClientHomeView firstName={firstName} tests={tests} attempts={attempts} />;
}
