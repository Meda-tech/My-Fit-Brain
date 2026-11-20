'use client';

import { useRouter } from 'next/navigation';
import { cn, inputClasses } from '../brand';

// My tasks filters: coordinator (super admins only) and Late only. Each change opens the matching address.
export function TaskFilters({
  coordinators,
  coordinatorId,
  lateOnly,
}: {
  coordinators: { id: string; full_name: string }[] | null;
  coordinatorId: string;
  lateOnly: boolean;
}) {
  const router = useRouter();
  const go = (next: { coordinator?: string; late?: boolean }) => {
    const q = new URLSearchParams();
    const c = next.coordinator ?? coordinatorId;
    const l = next.late ?? lateOnly;
    if (c) q.set('coordinator', c);
    if (l) q.set('late', '1');
    router.push(q.size ? `/tasks?${q}` : '/tasks', { scroll: false });
  };

  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      {coordinators && (
        <label className="flex min-w-0 flex-col gap-1.5 sm:w-72">
          <span className="sr-only">Coordinator</span>
          <select value={coordinatorId} onChange={(e) => go({ coordinator: e.target.value })} className={inputClasses}>
            <option value="">All coordinators</option>
            {coordinators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label
        className={cn(
          'inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] font-semibold',
          lateOnly ? 'border-teal bg-mist text-teal' : 'border-sand bg-white text-ink-soft hover:text-teal'
        )}
      >
        <input type="checkbox" checked={lateOnly} onChange={(e) => go({ late: e.target.checked })} className="h-4 w-4 accent-teal" />
        Late only
      </label>
    </div>
  );
}
