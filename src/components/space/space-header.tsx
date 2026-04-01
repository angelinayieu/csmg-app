"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Space } from "@/types";
import {
  Boxes,
  GitFork,
  RefreshCw,
  Circle,
  Clock,
  History,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChangelogPanel } from "./changelog-panel";

const maturityConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  actionable_now: {
    label: "Actionable",
    color: "text-green-700",
    bg: "bg-green-50",
  },
  waiting_on_dependency: {
    label: "Waiting",
    color: "text-amber-700",
    bg: "bg-amber-50",
  },
  theoretical: {
    label: "Theoretical",
    color: "text-blue-700",
    bg: "bg-blue-50",
  },
  blocked: { label: "Blocked", color: "text-red-700", bg: "bg-red-50" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function SpaceHeader({ space }: { space: Space }) {
  const router = useRouter();
  const maturity =
    maturityConfig[space.maturity] ?? maturityConfig.theoretical;
  const [reevaluating, setReevaluating] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function handleReevaluate() {
    setReevaluating(true);
    setToast(null);
    try {
      const res = await fetch("/api/reevaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: space.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const parts = [];
        if (data.added_edges > 0) parts.push(`${data.added_edges} connections`);
        if (data.added_cycles > 0) parts.push(`${data.added_cycles} cycles`);
        if (data.updated_entities > 0)
          parts.push(`${data.updated_entities} entities updated`);
        setToast(
          parts.length > 0
            ? `Added ${parts.join(", ")}`
            : "No new connections found"
        );
        router.refresh();
      } else {
        setToast(data.error ?? "Re-evaluation failed");
      }
    } catch {
      setToast("Re-evaluation failed");
    } finally {
      setReevaluating(false);
      setTimeout(() => setToast(null), 5000);
    }
  }

  return (
    <>
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-interaxis-100 text-lg font-bold text-interaxis-700">
              {space.space_prefix}
            </span>
            <div>
              <h1 className="text-2xl font-bold">{space.name}</h1>
              {space.description && (
                <p className="mt-1 text-sm text-gray-600">
                  {space.description}
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowChangelog(true)}
              className="text-gray-500"
            >
              <History className="mr-1.5 h-3.5 w-3.5" />
              History
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReevaluate}
              disabled={reevaluating}
            >
              {reevaluating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {reevaluating ? "Re-evaluating..." : "Re-evaluate"}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <Boxes className="h-4 w-4" />
            <span>{space.entity_count} entities</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <GitFork className="h-4 w-4" />
            <span>{space.edge_count} edges</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <RefreshCw className="h-4 w-4" />
            <span>{space.cycle_count} cycles</span>
          </div>
          {space.orphan_count > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-gray-400">
              <Circle className="h-4 w-4" />
              <span>{space.orphan_count} orphans</span>
            </div>
          )}
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              maturity.color,
              maturity.bg
            )}
          >
            {maturity.label}
          </span>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock className="h-3 w-3" />
            <span>Updated {timeAgo(space.updated_at)}</span>
          </div>
        </div>

        {/* Toast notification */}
        {toast && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {toast}
          </div>
        )}
      </div>

      {/* Changelog panel */}
      {showChangelog && (
        <ChangelogPanel
          spaceId={space.id}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </>
  );
}
