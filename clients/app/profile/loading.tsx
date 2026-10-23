import { PageChrome } from '../../components/PageChrome';
import { LoadingStatus, Skeleton, SkeletonCard } from '../../components/Skeleton';

export default function Loading() {
  return (
    <PageChrome>
      <LoadingStatus />
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
      </div>
      <SkeletonCard lines={5} />
    </PageChrome>
  );
}
