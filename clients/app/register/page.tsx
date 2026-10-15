import { redirect } from 'next/navigation';
import { getCurrentClient } from '../../lib/auth';
import { RegisterClientWrapper } from './RegisterClientWrapper';

export default async function RegisterPage() {
  const session = await getCurrentClient();

  // If user is not authenticated, bounce to /login
  if (!session || !session.user) {
    redirect('/login');
  }

  // If client record already exists, bounce to client home
  if (session.client) {
    redirect('/');
  }

  const phone = session.user.phone || '';

  return <RegisterClientWrapper userPhone={phone} />;
}
