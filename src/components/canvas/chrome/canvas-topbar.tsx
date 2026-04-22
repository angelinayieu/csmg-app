"use client";

import Link from "next/link";
import { ArrowLeft, Maximize2, Minimize2, Users, MoreHorizontal, Magnet, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type AutoAIState = "off" | "watching" | "running" | "cooldown";

export interface CanvasTopBarProps {
  spaceId: string;
  spaceName: string;
  entityCount: number;
  edgeCount: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  saveStatus: "saved" | "saving" | "idle" | "error";
  snapOn: boolean;
  onToggleSnap: () => void;
  autoAI: boolean;
  onToggleAutoAI: () => void;
  autoAIState: AutoAIState;
  autoAILastTarget?: string | null;
  /**
   * Phase 48 — slot for additional utility triggers (AI Receipts,
   * future quiet-mode toggle, etc.) rendered in the right pill.
   */
  extraTriggers?: React.ReactNode;
}

export function CanvasTopBar({
  spaceId,
  spaceName,
  entityCount,
  edgeCount,
  isFullscreen,
  onToggleFullscreen,
  saveStatus,
  snapOn,
  onToggleSnap,
  autoAI,
  onToggleAutoAI,
  autoAIState,
  autoAILastTarget,
  extraTriggers,
}: CanvasTopBarProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3",
      )}
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-gray-200/70 bg-white/80 px-2.5 py-1.5 shadow-sm backdrop-blur-md">
        <Link
          href={`/app/space/${spaceId}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Back to space"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <div className="flex items-center gap-2 pr-2">
          <div
            className="h-2 w-2 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shadow-sm"
            aria-hidden
          />
          <div className="text-[13px] font-semibold tracking-tight text-gray-900">
            {spaceName}
          </div>
          <div className="text-[11px] font-medium text-gray-400">
            {entityCount} · {edgeCount}
          </div>
        </div>
        <SaveBadge status={saveStatus} />
      </div>

      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-gray-200/70 bg-white/80 px-1.5 py-1.5 shadow-sm backdrop-blur-md">
        <button
          onClick={onToggleAutoAI}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors",
            autoAI
              ? "bg-gradient-to-br from-blue-50 to-purple-50 text-blue-700 ring-1 ring-blue-200"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
          )}
          title={
            autoAI
              ? autoAIState === "running"
                ? `Auto-AI: running on ${autoAILastTarget ?? "…"}`
                : autoAIState === "cooldown"
                  ? "Auto-AI: cooling down"
                  : "Auto-AI: watching for idle hubs to decompose"
              : "Auto-AI: off \u2014 click to let AI decompose hubs when you\u2019re idle"
          }
        >
          <Sparkles
            className={cn(
              "h-3 w-3",
              autoAI && autoAIState === "running" && "animate-pulse",
            )}
          />
          Auto-AI
          {autoAI && autoAIState === "running" && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          )}
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <button
          onClick={onToggleSnap}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors",
            snapOn
              ? "bg-blue-50 text-blue-700"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
          )}
          title={snapOn ? "Snap: on — hold Alt to disable" : "Snap: off — click to enable alignment guides"}
        >
          <Magnet className={cn("h-3 w-3", snapOn && "fill-blue-100")} />
          Snap
        </button>
        {/* Phase 48 — utility slot (AI Receipts, quiet-mode toggle, etc.). */}
        {extraTriggers && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            {extraTriggers}
          </>
        )}
        <div className="h-4 w-px bg-gray-200" />
        <button
          className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Collaborators (Phase 6)"
          disabled
        >
          <Users className="h-3 w-3" />
          Solo
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <button
          onClick={onToggleFullscreen}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen (F)"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="More"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function SaveBadge({ status }: { status: "saved" | "saving" | "idle" | "error" }) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider",
        status === "saved" && "bg-green-50 text-green-600",
        status === "saving" && "bg-amber-50 text-amber-600",
        status === "error" && "bg-red-50 text-red-600",
      )}
      title={
        status === "error"
          ? "Save failed — changes are mirrored to local storage but not synced to the server"
          : undefined
      }
    >
      {status === "saving" ? "Saving…" : status === "error" ? "Save failed" : "Saved"}
    </span>
  );
}
