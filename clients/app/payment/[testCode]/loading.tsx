import { PageChrome } from '../../../components/PageChrome';
import { LoadingStatus, Skeleton, SkeletonCard } from '../../../components/Skeleton';

export default function Loading() {
  return (
    <PageChrome nav={false}>
      <LoadingStatus />
      <Skeleton className="mb-6 h-8 w-64" />
      <SkeletonCard lines={4} className="mb-6" />
      <Skeleton className="h-12 w-full rounded-full" />
    </PageChrome>
  );
}
