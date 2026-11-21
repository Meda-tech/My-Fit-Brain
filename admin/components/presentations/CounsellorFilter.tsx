'use client';

import { useRouter } from 'next/navigation';
import { inputClasses } from '../brand';

// Super admins: show one counsellor's rows, or everyone's. `param` is the query key; `base` the page address.
export function CounsellorFilter({
  counsellors,
  value,
  base,
  param = 'counsellor',
  keep = {},
}: {
  counsellors: { id: string; full_name: string }[];
  value: string;
  base: string;
  param?: string;
  /** Other query values to keep (e.g. the tasks filter). */
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <label className="block w-full sm:w-72">
      <span className="sr-only">Counsellor</span>
      <select
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(keep);
          if (e.target.value) q.set(param, e.target.value);
          router.push(q.size ? `${base}?${q}` : base, { scroll: false });
        }}
        className={inputClasses}
      >
        <option value="">All counsellors</option>
        {counsellors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}
