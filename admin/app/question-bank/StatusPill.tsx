import { CircleDot, Clock, Archive, PencilLine } from 'lucide-react';
import type { VersionStatus } from '@mfb/questionbank';
import { Pill } from '../../components/brand';
import { STATUS_LABELS } from '../../lib/question-bank/data';

const ICONS: Record<VersionStatus, typeof CircleDot> = {
  live: CircleDot,
  in_review: Clock,
  draft: PencilLine,
  retired: Archive,
};

export function StatusPill({ status }: { status: VersionStatus }) {
  const Icon = ICONS[status];
  return (
    <Pill tone={status === 'live' || status === 'in_review' ? 'mist' : 'quiet'} className="whitespace-nowrap">
      <Icon size={13} strokeWidth={2} aria-hidden />
      {STATUS_LABELS[status]}
    </Pill>
  );
}
