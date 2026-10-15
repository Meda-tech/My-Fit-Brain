import { requireClient } from '../lib/auth';
import { ClientHomeView } from './ClientHomeView';

export const dynamic = 'force-dynamic';

export default async function ClientHomePage() {
  const { client } = await requireClient();

  return <ClientHomeView client={client} />;
}
