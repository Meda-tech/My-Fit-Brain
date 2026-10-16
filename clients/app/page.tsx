import { requireClient } from '../lib/auth';
import { homeData } from '../lib/assessment/server';
import { ClientHomeView } from './ClientHomeView';

export const dynamic = 'force-dynamic';

export default async function ClientHomePage() {
  const { client } = await requireClient();
  const { tests, attempts } = await homeData({
    id: client.id,
    gender: client.gender,
    age: client.age,
    marital_status: client.marital_status,
  });
  const firstName = client.full_name.trim().split(/\s+/)[0] || client.full_name;

  return <ClientHomeView firstName={firstName} tests={tests} attempts={attempts} />;
}
