"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MaturityBadge } from "@/components/ui/maturity-badge";
import { useAppStore } from "@/stores/store-provider";
import type { Space } from "@/types";

interface SpaceDetailCardProps {
  space: Space;
  isActive: boolean;
  subSpaces?: Space[];
}

export function SpaceDetailCard({
  space,
  isActive,
  subSpaces = [],
}: SpaceDetailCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const setSpaces = useAppStore((s) => s.setSpaces);
  const spaces = useAppStore((s) => s.spaces);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!confirming) {
      setConfirming(true);
      // Auto-dismiss after 3 seconds
      setTimeout(() => setConfirming(false), 3000);
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/spaces/${space.id}`, { method: "DELETE" });
      if (res.ok) {
        // Remove from store
        setSpaces(spaces.filter((s) => s.id !== space.id));
        // Navigate away if we're on this space's page
        if (pathname === `/app/space/${space.id}`) {
          router.push("/app");
        }
      }
    } catch {
      // Silently fail — space may already be deleted
    }
    setDeleting(false);
    setConfirming(false);
  }

  return (
    <div className="group relative">
      <Link
        href={`/app/space/${space.id}`}
        className={cn(
          "flex flex-col gap-1 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-interaxis-50 border border-interaxis-100"
            : "hover:bg-gray-100 border border-transparent"
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className={cn(
                "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-semibold",
                isActive
                  ? "bg-interaxis-200 text-interaxis-700"
                  : "bg-interaxis-100 text-interaxis-700"
              )}
            >
              {space.space_prefix}
            </span>
            <span className="truncate font-medium">{space.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MaturityBadge maturity={space.maturity} />
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                "rounded p-1 transition-all",
                confirming
                  ? "bg-red-100 text-red-600 opacity-100"
                  : "text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
              )}
              title={confirming ? "Click again to confirm" : "Delete space"}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="pl-7 text-[10px] text-gray-400">
          {space.entity_count} entities · {space.edge_count} edges
          {confirming && (
            <span className="ml-2 text-red-500 font-medium">Click trash again to confirm</span>
          )}
        </div>
      </Link>

      {/* Sub-spaces rendered flat with origin indicator */}
      {subSpaces.length > 0 &&
        subSpaces.map((sub) => (
          <Link
            key={sub.id}
            href={`/app/space/${sub.id}`}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
              pathname === `/app/space/${sub.id}`
                ? "bg-interaxis-50 border border-interaxis-100"
                : "hover:bg-gray-100 border border-transparent"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] font-semibold text-gray-500">
                {sub.space_prefix}
              </span>
              <span className="truncate text-xs font-medium">{sub.name}</span>
            </div>
            <div className="pl-7 text-[10px] text-gray-400">
              {sub.entity_count} entities · {sub.edge_count} edges
              <span className="ml-1 text-gray-300">
                &larr; {space.name}
              </span>
            </div>
          </Link>
        ))}
    </div>
  );
}
