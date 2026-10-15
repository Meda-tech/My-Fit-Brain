import { redirect } from 'next/navigation';
import { getCurrentStaff } from '../lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const staff = await getCurrentStaff();
  if (staff) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
