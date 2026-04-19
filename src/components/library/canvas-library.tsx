"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Archive, ArrowLeft, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasCardData, CanvasScope } from "@/types";
import { getCanvasScopeColor, canvasScopeColors } from "@/lib/design-tokens";
import { CanvasCard } from "./canvas-card";
import { CreateCanvasModal } from "./create-canvas-modal";

type TabKey = "all" | CanvasScope;

interface CanvasLibraryProps {
  initialCanvases: CanvasCardData[];
  spaceOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string }>;
  appOptions: Array<{ id: string; name: string; space_id: string }>;
  showArchived: boolean;
}

const TAB_ORDER: TabKey[] = ["all", "universal", "project", "objective", "app"];

export function CanvasLibrary({
  initialCanvases,
  spaceOptions,
  goalOptions,
  appOptions,
  showArchived,
}: CanvasLibraryProps) {
  const router = useRouter();
  const [canvases, setCanvases] = useState<CanvasCardData[]>(initialCanvases);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  // Counts per tab — drives the badges on the tab pills.
  const countsByScope = useMemo(() => {
    const m: Record<CanvasScope, number> = {
      universal: 0,
      project: 0,
      objective: 0,
      app: 0,
    };
    for (const c of canvases) m[c.scope] += 1;
    return m;
  }, [canvases]);

  const filtered = useMemo(
    () =>
      activeTab === "all"
        ? canvases
        : canvases.filter((c) => c.scope === activeTab),
    [canvases, activeTab],
  );

  // ── mutations ──
  async function togglePin(canvas: CanvasCardData) {
    setActionError(null);
    const next = !canvas.pinned;
    // optimistic
    setCanvases((prev) =>
      prev.map((c) => (c.id === canvas.id ? { ...c, pinned: next } : c)),
    );
    try {
      const res = await fetch(`/api/canvases/${canvas.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } catch (err) {
      // revert
      setCanvases((prev) =>
        prev.map((c) =>
          c.id === canvas.id ? { ...c, pinned: !next } : c,
        ),
      );
      setActionError(err instanceof Error ? err.message : "Pin failed");
    }
  }

  async function archiveCanvas(canvas: CanvasCardData) {
    setActionError(null);
    if (
      !confirm(
        `Archive "${canvas.title}"? You can restore it from the archived view.`,
      )
    )
      return;
    const prevList = canvases;
    // optimistic remove from active list
    setCanvases((prev) => prev.filter((c) => c.id !== canvas.id));
    try {
      const res = await fetch(`/api/canvases/${canvas.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } catch (err) {
      setCanvases(prevList);
      setActionError(err instanceof Error ? err.message : "Archive failed");
    }
  }

  async function restoreCanvas(canvas: CanvasCardData) {
    setActionError(null);
    const prevList = canvases;
    setCanvases((prev) => prev.filter((c) => c.id !== canvas.id));
    try {
      const res = await fetch(`/api/canvases/${canvas.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } catch (err) {
      setCanvases(prevList);
      setActionError(err instanceof Error ? err.message : "Restore failed");
    }
  }

  function handleCreated(newCanvas: CanvasCardData) {
    setCreateOpen(false);
    setActiveTab(newCanvas.scope);
    startTransition(() => {
      // Re-fetch on the server so scope_ref_name + pending_proposals
      // are consistent with the library's canonical hydration.
      router.refresh();
    });
    // Also optimistically prepend so the user sees the card immediately.
    setCanvases((prev) => [newCanvas, ...prev]);
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Header ── */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            <LayoutGrid className="h-3 w-3" />
            Library
          </div>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">
            {showArchived ? "Archived canvases" : "Your canvases"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {showArchived
              ? "Restore or permanently discard archived canvases."
              : "All canvases across every scope — universal, project, objective, and app."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showArchived ? (
            <Link
              href="/app/library"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Active canvases
            </Link>
          ) : (
            <Link
              href="/app/library?archived=1"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
            >
              <Archive className="h-3.5 w-3.5" />
              Archived
            </Link>
          )}
          <button
            onClick={() => setCreateOpen(true)}
            className="btn-gradient-outline inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold"
          >
            <Plus className="h-3.5 w-3.5" />
            New canvas
          </button>
        </div>
      </div>

      {/* ── Scope tabs ── (hidden in archived view since it's a cross-cut) */}
      {!showArchived && (
        <div className="mb-5 flex items-center gap-1.5 rounded-full bg-gray-100 p-1 w-fit">
          {TAB_ORDER.map((tab) => {
            const count =
              tab === "all" ? canvases.length : countsByScope[tab];
            const color =
              tab === "all" ? null : canvasScopeColors[tab];
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all",
                  active
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900",
                )}
              >
                {color && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: color.dot }}
                  />
                )}
                <span>{tab === "all" ? "All" : color!.label}</span>
                <span
                  className={cn(
                    "ml-0.5 min-w-[20px] rounded-full px-1.5 py-px text-[10px] tabular-nums",
                    active
                      ? "bg-gray-100 text-gray-700"
                      : "bg-gray-200 text-gray-600",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Error banner ── */}
      {actionError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* ── Grid ── */}
      {filtered.length === 0 ? (
        <EmptyState
          activeTab={activeTab}
          showArchived={showArchived}
          onCreate={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CanvasCard
              key={c.id}
              canvas={c}
              showArchived={showArchived}
              onTogglePin={() => togglePin(c)}
              onArchive={() => archiveCanvas(c)}
              onRestore={() => restoreCanvas(c)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateCanvasModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          spaceOptions={spaceOptions}
          goalOptions={goalOptions}
          appOptions={appOptions}
        />
      )}
    </div>
  );
}

function EmptyState({
  activeTab,
  showArchived,
  onCreate,
}: {
  activeTab: TabKey;
  showArchived: boolean;
  onCreate: () => void;
}) {
  if (showArchived) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 py-16 text-center">
        <Archive className="mx-auto h-7 w-7 text-gray-400" />
        <p className="mt-3 text-sm text-gray-600">No archived canvases.</p>
      </div>
    );
  }
  const color =
    activeTab !== "all" ? getCanvasScopeColor(activeTab) : null;
  const scopeLabel = color ? color.label.toLowerCase() : "";
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 py-16 text-center">
      <LayoutGrid className="mx-auto h-7 w-7 text-gray-400" />
      <p className="mt-3 text-sm font-medium text-gray-700">
        {activeTab === "all"
          ? "No canvases yet."
          : `No ${scopeLabel} canvases yet.`}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {activeTab === "universal"
          ? "Universal canvases span every project — great for synthesis across work."
          : activeTab === "project"
          ? "Project canvases live inside a single space."
          : activeTab === "objective"
          ? "Objective canvases are scoped to one improvement goal."
          : activeTab === "app"
          ? "App canvases are the leaf-level whiteboards attached to a generated app."
          : "Create your first canvas to start brainstorming."}
      </p>
      <button
        onClick={onCreate}
        className="btn-gradient-outline mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold"
      >
        <Plus className="h-3.5 w-3.5" />
        New canvas
      </button>
    </div>
  );
}
