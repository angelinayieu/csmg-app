import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Nav bar skeleton */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-full" />
        ))}
      </div>
      {/* Hero panel skeleton */}
      <Skeleton className="h-48 w-full max-w-3xl rounded-2xl" />
      {/* Hub skeleton */}
      <Skeleton className="h-32 w-32 rounded-full" />
      {/* Feature tiles skeleton */}
      <div className="grid w-full max-w-3xl grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {/* Chat skeleton */}
      <Skeleton className="mt-auto h-24 w-full max-w-3xl rounded-2xl" />
    </div>
  );
}
