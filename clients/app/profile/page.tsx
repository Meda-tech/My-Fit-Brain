import { requireClient } from '../../lib/auth';
import { ProfileView } from './ProfileView';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const { client } = await requireClient();
  return <ProfileView client={client} />;
}
