import { Pill } from '../brand';
import type { AttemptListRow } from '../../lib/services/attempts';

const LABELS: Record<AttemptListRow['status'], string> = {
  paid: 'Paid, not started',
  in_progress: 'In progress',
  completed: 'Completed',
  stopped: 'Stopped',
};

export function AttemptStatusPill({ status }: { status: AttemptListRow['status'] }) {
  return <Pill tone={status === 'completed' ? 'mist' : 'quiet'}>{LABELS[status]}</Pill>;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
