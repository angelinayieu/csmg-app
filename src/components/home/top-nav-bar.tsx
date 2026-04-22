"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, RefreshCw, Settings } from "lucide-react";
import type { Space } from "@/types";

interface TopNavBarProps {
  spaces: Space[];
}

export function TopNavBar({ spaces }: TopNavBarProps) {
  const router = useRouter();
  const lastSpace = spaces?.[0];

  return (
    <nav className="anim-fade-down delay-100 glass-nav-bar mx-auto flex max-w-[760px] items-stretch gap-2 px-3 py-2.5">
      {/* Space selector pill */}
      <Link href={lastSpace ? `/app/space/${lastSpace.id}` : "/app"} className="glass-nav-pill">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-gray-400">
            Space
          </span>
          <span className="truncate whitespace-nowrap text-[13px] font-semibold text-gray-800">
            {lastSpace?.name ?? "None"}
          </span>
        </div>
        <ChevronDown className="ml-2 h-3 w-3 flex-shrink-0 text-gray-400" />
      </Link>

      {/* Create pill */}
      <Link href="/app/new" className="glass-nav-pill">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-gray-400">
            Create
          </span>
          <span className="truncate whitespace-nowrap text-[13px] font-semibold text-gray-800">
            New Analysis
          </span>
        </div>
        <Plus className="ml-2 h-3 w-3 flex-shrink-0 text-gray-400" />
      </Link>

      {/* View pill */}
      <Link href="/app/bridges" className="glass-nav-pill">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-gray-400">
            View
          </span>
          <span className="truncate whitespace-nowrap text-[13px] font-semibold text-gray-800">
            Meta-Graph
          </span>
        </div>
        <ChevronDown className="ml-2 h-3 w-3 flex-shrink-0 text-gray-400" />
      </Link>

      {/* Settings pill */}
      <Link href="/app/settings" className="glass-nav-pill">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-gray-400">
            Settings
          </span>
          <span className="truncate whitespace-nowrap text-[13px] font-semibold text-gray-800">
            Profile
          </span>
        </div>
        <ChevronDown className="ml-2 h-3 w-3 flex-shrink-0 text-gray-400" />
      </Link>

      {/* Refresh button */}
      <button
        onClick={() => router.refresh()}
        className="flex w-10 flex-shrink-0 items-center justify-center self-stretch rounded-xl bg-white/55 border border-white/70 shadow-sm transition-all hover:bg-white/75 hover:rotate-180 duration-500"
      >
        <RefreshCw className="h-4 w-4 text-gray-500" />
      </button>
    </nav>
  );
}
