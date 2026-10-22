import { Archive, CircleDot, PencilLine } from 'lucide-react';
import { Pill } from '../../components/brand';
import { STATUS_LABELS, type VersionStatus } from '../../lib/services/questionnaires';

const ICONS: Record<VersionStatus, typeof CircleDot> = { live: CircleDot, draft: PencilLine, retired: Archive };

export function StatusPill({ status }: { status: VersionStatus }) {
  const Icon = ICONS[status];
  return (
    <Pill tone={status === 'live' ? 'mist' : 'quiet'} className="whitespace-nowrap">
      <Icon size={13} strokeWidth={2} aria-hidden />
      {STATUS_LABELS[status]}
    </Pill>
  );
}
