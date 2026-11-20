'use client';

import { useRouter } from 'next/navigation';
import { inputClasses } from '../brand';

// Pick a counsellor: opens the same month for them.
export function CounsellorPicker({
  counsellors,
  counsellorId,
  month,
}: {
  counsellors: { id: string; full_name: string }[];
  counsellorId: string;
  month: string;
}) {
  const router = useRouter();
  return (
    <label className="block w-full sm:w-72">
      <span className="sr-only">Counsellor</span>
      <select
        value={counsellorId}
        onChange={(e) => router.push(`/availability?${new URLSearchParams({ c: e.target.value, m: month })}`, { scroll: false })}
        className={inputClasses}
      >
        {counsellors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}
