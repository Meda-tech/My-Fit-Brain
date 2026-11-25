'use client';

import { useRouter } from 'next/navigation';
import { inputClasses } from '../brand';
import { CRM_NOT_ASSIGNED } from '../../lib/roles';

// Super admins: show one CRM person's packages, the ones not assigned yet, or everyone's.
export function CrmFilter({ staff, value, showNotAssigned }: { staff: { id: string; full_name: string }[]; value: string; showNotAssigned: boolean }) {
  const router = useRouter();
  return (
    <label className="block w-full sm:w-72">
      <span className="sr-only">CRM</span>
      <select value={value} onChange={(e) => router.push(e.target.value ? `/crm?crm=${e.target.value}` : '/crm', { scroll: false })} className={inputClasses}>
        <option value="">All CRM</option>
        {staff.map((c) => (
          <option key={c.id} value={c.id}>
            {c.full_name}
          </option>
        ))}
        {showNotAssigned && <option value={CRM_NOT_ASSIGNED}>Not assigned yet</option>}
      </select>
    </label>
  );
}
