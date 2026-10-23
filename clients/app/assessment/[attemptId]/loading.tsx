import { PageChrome } from '../../../components/PageChrome';
import { LoadingStatus, Skeleton } from '../../../components/Skeleton';

// One question screen while it loads: progress, question, answer cards.
export default function Loading() {
  return (
    <PageChrome nav={false}>
      <LoadingStatus />
      <Skeleton className="mb-6 h-1.5 w-full rounded-full" />
      <Skeleton className="mb-2 h-7 w-full" />
      <Skeleton className="mb-6 h-7 w-3/4" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-card" />
        ))}
      </div>
    </PageChrome>
  );
}
