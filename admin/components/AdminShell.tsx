import { cookies } from 'next/headers';
import { StaffRole } from '../lib/types';
import { AdminShellClient } from './AdminShellClient';
import { SIDEBAR_COOKIE } from './sidebar-cookie';

interface AdminShellProps {
  fullName: string;
  role: StaffRole;
  children: React.ReactNode;
}

export async function AdminShell({ fullName, role, children }: AdminShellProps) {
  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed';

  return (
    <AdminShellClient fullName={fullName} role={role} initialCollapsed={initialCollapsed}>
      {children}
    </AdminShellClient>
  );
}
