import { CheckCircle2, Clock } from 'lucide-react';
import { Pill } from './brand';

export function ClientStatusPill({ linked }: { linked: boolean }) {
  return linked ? (
    <Pill className="whitespace-nowrap">
      <CheckCircle2 size={13} strokeWidth={2} aria-hidden />
      Verified &amp; Linked
    </Pill>
  ) : (
    <Pill tone="quiet" className="whitespace-nowrap">
      <Clock size={13} strokeWidth={2} aria-hidden />
      Pending First Login
    </Pill>
  );
}
