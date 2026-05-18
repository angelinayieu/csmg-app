"use client";

// Tiny client island for the timeline page — calls router.refresh()
// to re-derive pipeline state without a hard page reload. The button
// briefly shows a spinner while the server roundtrip runs so the
// user gets immediate feedback that something happened.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

export function TimelineRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastClickedAt, setLastClickedAt] = useState<number | null>(null);

  const handleClick = () => {
    setLastClickedAt(Date.now());
    startTransition(() => {
      router.refresh();
    });
  };

  // Show a brief "just refreshed" affordance after a successful click.
  const showJustRefreshed =
    lastClickedAt !== null && !isPending && Date.now() - lastClickedAt < 2000;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-60"
    >
      <RotateCw
        className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`}
        aria-hidden
      />
      {isPending
        ? "Refreshing…"
        : showJustRefreshed
          ? "✓ Refreshed"
          : "Refresh state"}
    </button>
  );
}
