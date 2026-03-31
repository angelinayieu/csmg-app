import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { Space } from "@/types";

export function SpaceCard({ space }: { space: Space }) {
  return (
    <Link href={`/app/space/${space.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            {space.space_prefix}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium">{space.name}</h3>
            {space.description && (
              <p className="mt-1 truncate text-sm text-gray-600 dark:text-gray-400">
                {space.description}
              </p>
            )}
            <div className="mt-3 flex gap-4 text-xs text-gray-500">
              <span>{space.entity_count} entities</span>
              <span>{space.edge_count} edges</span>
              <span>{space.cycle_count} cycles</span>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
