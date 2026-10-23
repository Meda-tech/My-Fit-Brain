import { PageChrome } from '../components/PageChrome';
import { LoadingStatus, Skeleton, SkeletonCard } from '../components/Skeleton';

// Home while it loads: the header and tab bar appear at once, grey shapes stand in for the content.
export default function Loading() {
  return (
    <PageChrome>
      <LoadingStatus />
      <div className="mb-6">
        <span aria-hidden className="mb-3 block h-2.5 w-2.5 rounded-full bg-coral" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="mb-3 h-6 w-44" />
      <SkeletonCard className="mb-8" />
      <Skeleton className="mb-3 h-6 w-40" />
      <SkeletonCard lines={3} className="mb-4" />
      <SkeletonCard lines={3} />
    </PageChrome>
  );
}
