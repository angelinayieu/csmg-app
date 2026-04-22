"use client";

// ── Strategy Version History drawer (Arc 4 Phase A) ─────────────────────
//
// Lists every snapshot in the space, newest-first. Each row shows:
//   • Label (user_label when set, else "v{version}")
//   • Status chip (reviewing / confirmed / superseded / generated)
//   • Timestamp + trigger kind (manual / auto_chain / resynthesize)
//   • Tactic count (preview metric)
//   • Rename affordance (double-click label → inline input, Enter commits)
//   • "Open in canvas" CTA — emits onSendToCanvas so the parent can place
//     the snapshot as a tldraw StrategyShape on the freestyle canvas
//
// Design:
//   • Slim collapsible drawer — matches the change-proposals banner visual
//     family (glass surface, soft border, tabular-nums). Stays collapsed
//     on pages with a single snapshot (noise suppression).
//   • Keyboard: E renames focused row, Enter commits, Esc cancels.
//   • Reduced-motion respected throughout.
//   • ARIA: role="list", each row is role="listitem" + aria-label.
//
// Data contract: see GET /api/spaces/:id/strategy-snapshots which always
// populates `label` (never null), so this component doesn't need fallbacks.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, Archive, Eye, Sparkles, Clock,
  ChevronDown, Pencil, ExternalLink, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { toast } from "@/lib/hooks/use-toast";
import type {
  StrategySnapshotSummary,
  StrategySnapshotsResponse,
} from "@/app/api/spaces/[id]/strategy-snapshots/route";

interface Props {
  spaceId: string;
  /**
   * Optional callback — called when the user clicks "Open in canvas" on a
   * snapshot row. Consumer decides how to manifest the snapshot (route
   * navigation, canvas shape placement, drawer close, etc.).
   */
  onSendToCanvas?: (snapshot: StrategySnapshotSummary) => void;
  className?: string;
}

const STATUS_META: Record<
  StrategySnapshotSummary["status"],
  { label: string; chip: string; icon: React.ElementType }
> = {
  confirmed: {
    label: "Confirmed",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    icon: CheckCircle2,
  },
  reviewing: {
    label: "Reviewing",
    chip: "bg-amber-50 text-amber-700 ring-amber-200",
    icon: Eye,
  },
  generated: {
    label: "Generated",
    chip: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    icon: Sparkles,
  },
  superseded: {
    label: "Superseded",
    chip: "bg-gray-50 text-gray-500 ring-gray-200",
    icon: Archive,
  },
};

const TRIGGER_HINT: Record<StrategySnapshotSummary["trigger"], string> = {
  manual: "Regenerated manually",
  auto_chain: "Auto-chain regen",
  resynthesize: "Resynthesized after change",
};

function formatAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86400);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(then).toLocaleDateString();
}

export function StrategyVersionHistory({ spaceId, onSendToCanvas, className }: Props) {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<StrategySnapshotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/spaces/${spaceId}/strategy-snapshots`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as StrategySnapshotsResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          console.warn("[strategy-version-history] load failed:", e);
          setData({ snapshots: [], confirmed_version: null, latest_version: null });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const snapshots = data?.snapshots ?? [];

  // Auto-expand if there are multiple versions (implies user cares about history).
  useEffect(() => {
    if (snapshots.length >= 2) setExpanded(true);
  }, [snapshots.length]);

  const startRename = (snapshot: StrategySnapshotSummary) => {
    setRenaming(snapshot.id);
    setRenameValue(snapshot.user_label ?? "");
    // Delay so the input exists in the DOM
    requestAnimationFrame(() => renameInputRef.current?.select());
  };

  const commitRename = async (snapshot: StrategySnapshotSummary) => {
    const trimmed = renameValue.trim();
    const nextLabel = trimmed.length === 0 ? null : trimmed;
    // No-op when nothing changed
    if (nextLabel === snapshot.user_label) {
      setRenaming(null);
      return;
    }
    try {
      const res = await fetch(`/api/spaces/${spaceId}/strategy-snapshots`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_id: snapshot.id, user_label: nextLabel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Rename failed" }));
        throw new Error(err.error ?? "Rename failed");
      }
      // Optimistic local update
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          snapshots: prev.snapshots.map((s) =>
            s.id === snapshot.id
              ? { ...s, user_label: nextLabel, label: nextLabel ?? `v${s.version}` }
              : s,
          ),
        };
      });
      toast.success("Strategy version renamed");
    } catch (e) {
      toast.error("Couldn't rename", { description: (e as Error).message });
    } finally {
      setRenaming(null);
    }
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameValue("");
  };

  const summary = useMemo(() => {
    if (snapshots.length === 0) return null;
    const confirmed = snapshots.find((s) => s.status === "confirmed");
    if (confirmed) return `${snapshots.length} versions · current: ${confirmed.label}`;
    return `${snapshots.length} version${snapshots.length === 1 ? "" : "s"}`;
  }, [snapshots]);

  // Don't render at all when there's no history to show
  if (loading) return null;
  if (snapshots.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-2xl border border-indigo-200/50 bg-gradient-to-br from-indigo-50/30 to-white/80 backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden",
        className,
      )}
      aria-label="Strategy version history"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "group w-full flex items-center gap-3 px-4 py-3 text-left",
          !reducedMotion && "transition-colors",
          "hover:bg-indigo-50/30",
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200">
          <Clock className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-700">
            Version history
          </div>
          <div className="text-[11.5px] text-gray-600">{summary}</div>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-gray-500",
            !reducedMotion && "transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <ul
          role="list"
          className="divide-y divide-indigo-100/60 border-t border-indigo-100/60"
        >
          {snapshots.map((snapshot) => {
            const meta = STATUS_META[snapshot.status];
            const Icon = meta.icon;
            const isRenaming = renaming === snapshot.id;
            const isConfirmed = snapshot.status === "confirmed";

            return (
              <li
                key={snapshot.id}
                role="listitem"
                aria-label={`Strategy ${snapshot.label}, ${meta.label}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5",
                  isConfirmed && "bg-emerald-50/20",
                )}
              >
                {/* Status chip */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-[1px] text-[9.5px] font-semibold shrink-0",
                    meta.chip,
                  )}
                  title={TRIGGER_HINT[snapshot.trigger]}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {meta.label}
                </span>

                {/* Label (rename on double-click) */}
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename(snapshot);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={() => void commitRename(snapshot)}
                      placeholder={`v${snapshot.version}`}
                      maxLength={80}
                      aria-label="Rename strategy version"
                      className="w-full rounded-md ring-1 ring-indigo-300 bg-white px-2 py-0.5 text-[12px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  ) : (
                    <button
                      type="button"
                      onDoubleClick={() => startRename(snapshot)}
                      title="Double-click to rename"
                      className={cn(
                        "inline-flex items-center gap-1.5 text-left max-w-full",
                      )}
                    >
                      <span className="text-[12.5px] font-semibold text-gray-900 truncate">
                        {snapshot.label}
                      </span>
                      {!snapshot.user_label && (
                        <Pencil className="h-2.5 w-2.5 text-gray-300 opacity-0 group-hover:opacity-100" />
                      )}
                    </button>
                  )}
                  <div className="text-[10.5px] text-gray-500 flex items-center gap-1.5 tabular-nums">
                    <span>{formatAge(snapshot.created_at)}</span>
                    {snapshot.tactic_count !== null && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span>
                          {snapshot.tactic_count} tactic
                          {snapshot.tactic_count === 1 ? "" : "s"}
                        </span>
                      </>
                    )}
                    {snapshot.quality_score !== null && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span title="Validation score">
                          q {snapshot.quality_score}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {onSendToCanvas && (
                  <button
                    type="button"
                    onClick={() => onSendToCanvas(snapshot)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold shrink-0",
                      "bg-white ring-1 ring-gray-200 text-gray-600",
                      "hover:bg-indigo-500 hover:text-white hover:ring-indigo-500",
                      !reducedMotion && "transition-colors",
                    )}
                    title="Open in freestyle canvas"
                  >
                    <Zap className="h-2.5 w-2.5" />
                    Canvas
                    <ExternalLink className="h-2 w-2 opacity-70" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
