import { Skeleton } from "@/components/ui/skeleton";

export default function SpaceLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-6 h-96 w-full rounded-xl" />
    </div>
  );
}
