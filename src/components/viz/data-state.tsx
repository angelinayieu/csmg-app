"use client";

// ── Data state layer ───────────────────────────────────────────────────
//
// Single wrapper that every viz uses so loading/empty/error/data all look
// consistent across the app. Without this, every chart invents its own
// skeleton and empty state — the dashboard gets visually noisy fast.
//
// Usage:
//   <DataStateLayer
//     loading={isFetching}
//     error={error}
//     empty={items.length === 0}
//     emptyHint="No causal chains generated yet."
//   >
//     <MyChart items={items} />
//   </DataStateLayer>

import type { ReactNode } from "react";
import { Loader2, AlertCircle, Inbox } from "lucide-react";

interface DataStateLayerProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyHint?: string;
  emptyAction?: ReactNode;
  minHeight?: number;
  children: ReactNode;
}

export function DataStateLayer({
  loading,
  error,
  empty,
  emptyHint,
  emptyAction,
  minHeight = 240,
  children,
}: DataStateLayerProps) {
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-gray-400"
        style={{ minHeight }}
      >
        <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
        <p className="text-[11px] font-medium">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-center px-4"
        style={{ minHeight }}
      >
        <AlertCircle className="h-5 w-5 text-red-400" />
        <p className="text-[11.5px] font-medium text-gray-700">Couldn&apos;t load this view</p>
        <p className="text-[10.5px] text-gray-500 max-w-[260px] leading-relaxed">{error}</p>
      </div>
    );
  }

  if (empty) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-center px-4"
        style={{ minHeight }}
      >
        <Inbox className="h-5 w-5 text-gray-300" />
        {emptyHint ? (
          <p className="text-[11.5px] text-gray-500 max-w-[280px] leading-relaxed">
            {emptyHint}
          </p>
        ) : null}
        {emptyAction}
      </div>
    );
  }

  return <>{children}</>;
}
