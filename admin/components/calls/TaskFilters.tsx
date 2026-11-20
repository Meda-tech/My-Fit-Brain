'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn, inputClasses } from '../brand';
import { TASK_SHOWS, TASK_SHOW_LABELS, tasksHref, type TaskShow } from '../../lib/calls';

// My tasks filters, at the top: All · Late only · Upcoming (everyone), and the coordinator (super admins only).
export function TaskFilters({
  coordinators,
  coordinatorId,
  show,
  counts,
}: {
  coordinators: { id: string; full_name: string }[] | null;
  coordinatorId: string;
  show: TaskShow;
  counts: Record<TaskShow, number>;
}) {
  const router = useRouter();

  return (
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <nav aria-label="Show" className="flex w-full gap-1 overflow-x-auto rounded-full border border-sand bg-white p-1 sm:w-fit">
        {TASK_SHOWS.map((s) => (
          <Link
            key={s}
            href={tasksHref(coordinatorId, s)}
            scroll={false}
            aria-current={s === show ? 'page' : undefined}
            className={cn(
              'flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold sm:flex-none',
              s === show ? 'bg-teal text-white' : 'text-ink-soft hover:bg-mist hover:text-teal'
            )}
          >
            {TASK_SHOW_LABELS[s]}
            <span className={cn('rounded-full px-1.5 text-[12px] leading-5', s === show ? 'bg-white/20 text-white' : 'bg-cream text-ink-muted')}>
              {counts[s]}
            </span>
          </Link>
        ))}
      </nav>
      {coordinators && (
        <label className="block lg:w-72">
          <span className="sr-only">Coordinator</span>
          <select
            value={coordinatorId}
            onChange={(e) => router.push(tasksHref(e.target.value, show), { scroll: false })}
            className={inputClasses}
          >
            <option value="">All coordinators</option>
            {coordinators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
