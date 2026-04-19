"use client";

// Phase 44 — AI Receipts drawer + HUD toggle.
//
// Renders a tethered floating button on the canvas HUD with a pulse
// counter when unseen receipts accumulate. Click → a right-side
// Reactor-Glass drawer slides in with a reverse-chronological list of
// what the AI has done in this space. Each row has type glyph,
// timestamp, title, detail line, entity chips, and a dismiss ×.
//
// Real Undo is Phase 45 — it needs a server round-trip to remove
// created entities and is out of scope for this phase. We surface the
// `undoable` flag so Phase 45's CTA slot is already reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  FlaskConical,
  Layers,
  Loader2,
  RotateCcw,
  Upload,
  X,
  Zap,
  Network,
} from "lucide-react";
import type { AIReceipt, ReceiptKind, UseAIReceipts } from "../hooks/use-ai-receipts";

const KIND_META: Record<
  ReceiptKind,
  { label: string; color: string; glyph: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }
> = {
  "auto-decompose": {
    label: "Auto-decompose",
    color: "#a78bfa",
    glyph: Zap,
  },
  decompose: {
    label: "Decompose",
    color: "#a78bfa",
    glyph: Layers,
  },
  ingest: {
    label: "Ingest",
    color: "#22d3ee",
    glyph: Upload,
  },
  "reaction-save": {
    label: "Reaction",
    color: "#4ade80",
    glyph: FlaskConical,
  },
  "bridge-suggest": {
    label: "Bridge",
    color: "#22d3ee",
    glyph: Network,
  },
};

function relativeTime(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export interface CanvasAIReceiptsProps {
  receipts: UseAIReceipts;
}

export function CanvasAIReceipts({ receipts }: CanvasAIReceiptsProps) {
  const [open, setOpen] = useState(false);
  const { activeCount, receipts: all, dismiss, dismissAll, markUndone } =
    receipts;
  const router = useRouter();

  // Phase 46 — track in-flight undos so the button shows a spinner and
  // users can't double-fire. Keyed by receipt id.
  const [undoingIds, setUndoingIds] = useState<Set<string>>(new Set());
  const [undoErrors, setUndoErrors] = useState<Record<string, string>>({});

  const handleUndo = useCallback(
    async (receipt: AIReceipt) => {
      const targets = receipt.undo_target_ids ?? [];
      if (targets.length === 0) return;
      setUndoingIds((prev) => {
        const next = new Set(prev);
        next.add(receipt.id);
        return next;
      });
      setUndoErrors((prev) => {
        if (!prev[receipt.id]) return prev;
        const next = { ...prev };
        delete next[receipt.id];
        return next;
      });
      try {
        const res = await fetch("/api/entities/bulk-delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: targets }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        markUndone(receipt.id);
        // Re-fetch the server-component tree so the canvas drops the
        // deleted entities on the next render.
        router.refresh();
      } catch (err) {
        setUndoErrors((prev) => ({
          ...prev,
          [receipt.id]: err instanceof Error ? err.message : "Undo failed",
        }));
      } finally {
        setUndoingIds((prev) => {
          const next = new Set(prev);
          next.delete(receipt.id);
          return next;
        });
      }
    },
    [markUndone, router],
  );

  // Close on ESC (but don't consume it if another dialog opens later).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Briefly pulse the button when a new receipt arrives while the
  // drawer is closed — cheap attention grabber without a toast.
  const prevCountRef = useRef(activeCount);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (!open && activeCount > prevCountRef.current) {
      setPulseKey((k) => k + 1);
    }
    prevCountRef.current = activeCount;
  }, [activeCount, open]);

  const visible = useMemo(() => all.filter((r) => !r.dismissed), [all]);

  return (
    <>
      {/* HUD toggle button — bottom-left, above the tool dock. Counter
          badge appears when unseen receipts exist. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          activeCount > 0
            ? `${activeCount} AI receipts · open log`
            : "Open AI receipts log"
        }
        title={
          activeCount > 0
            ? `${activeCount} AI receipt${activeCount === 1 ? "" : "s"} · click to review`
            : "AI receipts log"
        }
        className="group absolute bottom-24 left-5 z-30 flex items-center gap-2 rounded-full border bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-gray-700 shadow-md backdrop-blur-md transition-all hover:border-violet-300 hover:bg-white"
        style={{
          borderColor: open
            ? "rgba(167, 139, 250, 0.6)"
            : activeCount > 0
              ? "rgba(167, 139, 250, 0.35)"
              : "rgba(148, 163, 184, 0.3)",
        }}
      >
        <Activity
          className="h-3.5 w-3.5 transition-colors"
          style={{ color: activeCount > 0 ? "#a78bfa" : "#64748b" }}
        />
        <span>AI Receipts</span>
        {activeCount > 0 && (
          <span
            key={pulseKey}
            className="ml-1 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 py-0.5 font-mono text-[9px] font-bold text-white"
            style={{
              background: "#a78bfa",
              boxShadow: "0 0 10px rgba(167, 139, 250, 0.6)",
              animation: "canvas-receipt-pulse 900ms ease-out",
            }}
          >
            {activeCount > 99 ? "99+" : activeCount}
          </span>
        )}
      </button>

      {/* Drawer — slides from right. Reactor-glass dark panel so it reads
          as the "AI side" of the app, distinct from the light canvas. */}
      {open && (
        <>
          <div
            className="pointer-events-auto absolute inset-0 z-40"
            onClick={() => setOpen(false)}
            style={{
              background: "rgba(2, 5, 10, 0.28)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              animation: "canvas-receipt-scrim-in 200ms ease-out",
            }}
          />
          <aside
            role="dialog"
            aria-label="AI Receipts log"
            className="absolute right-0 top-0 bottom-0 z-50 w-[380px]"
            style={{
              animation:
                "canvas-receipt-drawer-in 280ms cubic-bezier(0.25, 1, 0.5, 1) forwards",
              background: "rgba(10, 15, 23, 0.92)",
              backdropFilter: "blur(40px) saturate(1.3)",
              WebkitBackdropFilter: "blur(40px) saturate(1.3)",
              borderLeft: "1px solid rgba(167, 139, 250, 0.25)",
              boxShadow:
                "inset 1px 0 0 rgba(167, 139, 250, 0.14), -20px 0 60px rgba(0, 0, 0, 0.5)",
              color: "#e8edf4",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header */}
            <header
              className="flex items-center gap-3 border-b px-4 py-3"
              style={{ borderColor: "rgba(148, 163, 184, 0.08)" }}
            >
              <span
                className="grid h-8 w-8 place-items-center rounded-full"
                style={{
                  background: "rgba(167, 139, 250, 0.1)",
                  border: "1px solid rgba(167, 139, 250, 0.35)",
                  boxShadow: "0 0 14px rgba(167, 139, 250, 0.2)",
                }}
              >
                <Activity className="h-4 w-4" style={{ color: "#a78bfa" }} />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[8.5px] font-semibold uppercase tracking-[0.2em]"
                  style={{ color: "#a78bfa" }}
                >
                  AI Receipts
                </div>
                <div className="text-[15px] font-bold leading-tight">
                  What the AI did
                </div>
              </div>
              {visible.length > 0 && (
                <button
                  type="button"
                  onClick={dismissAll}
                  title="Dismiss all receipts"
                  className="rounded-[3px] border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors"
                  style={{
                    borderColor: "rgba(148, 163, 184, 0.2)",
                    background: "#141b26",
                    color: "#a8b3c4",
                  }}
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close receipts log"
                title="Close"
                className="grid h-7 w-7 place-items-center rounded-[3px] border text-[#a8b3c4] transition-colors hover:border-[#f472b6]/40 hover:bg-[#f472b6]/10 hover:text-[#f472b6]"
                style={{
                  borderColor: "rgba(148, 163, 184, 0.14)",
                  background: "#141b26",
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {visible.length === 0 ? (
                <ReceiptEmpty />
              ) : (
                <div className="space-y-2">
                  {visible.map((r) => (
                    <ReceiptRow
                      key={r.id}
                      receipt={r}
                      onDismiss={() => dismiss(r.id)}
                      onUndo={() => handleUndo(r)}
                      undoing={undoingIds.has(r.id)}
                      undoError={undoErrors[r.id] ?? null}
                    />
                  ))}
                </div>
              )}
            </div>

            <footer
              className="border-t px-4 py-2 font-mono text-[9px] tracking-[0.12em] text-[#475569]"
              style={{ borderColor: "rgba(148, 163, 184, 0.08)" }}
            >
              {all.length} total · {activeCount} active · v1 local
            </footer>
          </aside>
        </>
      )}

      {/* Animations — scoped via <style jsx global> is overkill; a plain
          <style> works fine and keeps this component self-contained. */}
      <style>{`
        @keyframes canvas-receipt-pulse {
          0%   { transform: scale(1); }
          30%  { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
        @keyframes canvas-receipt-scrim-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes canvas-receipt-drawer-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}

function ReceiptRow({
  receipt,
  onDismiss,
  onUndo,
  undoing,
  undoError,
}: {
  receipt: AIReceipt;
  onDismiss: () => void;
  onUndo: () => void;
  undoing: boolean;
  undoError: string | null;
}) {
  const meta = KIND_META[receipt.kind];
  const Glyph = meta.glyph;
  const canUndo =
    receipt.undoable &&
    !receipt.undone_at &&
    (receipt.undo_target_ids?.length ?? 0) > 0;
  const isUndone = !!receipt.undone_at;
  return (
    <div
      className="group relative overflow-hidden rounded-[4px] border p-3"
      style={{
        borderColor: isUndone
          ? "rgba(244, 114, 182, 0.15)"
          : "rgba(148, 163, 184, 0.1)",
        background: isUndone
          ? "rgba(244, 114, 182, 0.04)"
          : "rgba(20, 27, 38, 0.7)",
        opacity: isUndone ? 0.7 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
          aria-hidden
          style={{
            background: `${meta.color}18`,
            border: `1px solid ${meta.color}44`,
          }}
        >
          <Glyph className="h-3.5 w-3.5" style={{ color: meta.color }} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: meta.color }}
            >
              {meta.label}
            </span>
            <span
              className="font-mono text-[9px] text-[#64748b]"
              title={new Date(receipt.at).toLocaleString()}
            >
              {relativeTime(receipt.at)}
            </span>
            {isUndone && (
              <span
                className="flex items-center gap-1 rounded-sm px-1 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.14em]"
                style={{
                  background: "rgba(244, 114, 182, 0.12)",
                  color: "#f472b6",
                }}
                title={
                  receipt.undone_at
                    ? `Undone ${relativeTime(receipt.undone_at)}`
                    : "Undone"
                }
              >
                <RotateCcw className="h-2.5 w-2.5" />
                Undone
              </span>
            )}
          </div>
          <div
            className="mt-0.5 text-[12.5px] font-semibold leading-snug"
            style={{
              color: isUndone ? "#a8b3c4" : "#e8edf4",
              textDecoration: isUndone ? "line-through" : "none",
            }}
          >
            {receipt.title}
          </div>
          {receipt.detail && (
            <div className="mt-1 text-[10.5px] leading-relaxed text-[#a8b3c4]">
              {receipt.detail}
            </div>
          )}
          {receipt.entity_ids.length > 0 && (
            <div className="mt-2 font-mono text-[9px] text-[#64748b]">
              {receipt.entity_ids.length}{" "}
              {receipt.entity_ids.length === 1 ? "entity" : "entities"}{" "}
              affected
            </div>
          )}
          {undoError && (
            <div
              className="mt-2 rounded-sm border px-2 py-1 font-mono text-[9.5px]"
              style={{
                borderColor: "rgba(244, 114, 182, 0.3)",
                background: "rgba(244, 114, 182, 0.06)",
                color: "#f472b6",
              }}
              role="alert"
            >
              {undoError}
            </div>
          )}
          {/* Phase 46 — real Undo button. */}
          {canUndo && (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={onUndo}
                disabled={undoing}
                aria-label="Undo this action"
                title={`Delete the ${receipt.undo_target_ids?.length ?? 0} ${
                  (receipt.undo_target_ids?.length ?? 0) === 1
                    ? "entity"
                    : "entities"
                } this action created`}
                className="inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:cursor-wait"
                style={{
                  borderColor: "rgba(251, 191, 36, 0.4)",
                  background: "rgba(251, 191, 36, 0.08)",
                  color: "#fbbf24",
                }}
              >
                {undoing ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-2.5 w-2.5" />
                )}
                {undoing ? "Undoing…" : "Undo"}
              </button>
              <span className="font-mono text-[8.5px] text-[#475569]">
                removes {receipt.undo_target_ids?.length ?? 0}{" "}
                {(receipt.undo_target_ids?.length ?? 0) === 1
                  ? "entity"
                  : "entities"}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss receipt"
          title="Dismiss"
          className="grid h-6 w-6 place-items-center rounded-[3px] text-[#64748b] opacity-0 transition-all group-hover:opacity-100 hover:bg-[#f472b6]/10 hover:text-[#f472b6]"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function ReceiptEmpty() {
  return (
    <div className="mx-auto mt-12 max-w-[280px] text-center">
      <span
        className="mb-3 inline-grid h-10 w-10 place-items-center rounded-full"
        style={{
          background: "rgba(167, 139, 250, 0.06)",
          border: "1px solid rgba(167, 139, 250, 0.2)",
          color: "#a78bfa",
        }}
      >
        <Activity className="h-4 w-4" />
      </span>
      <div className="text-[13px] font-semibold text-[#e8edf4]">
        Nothing yet
      </div>
      <div
        className="mt-1 text-[10.5px] leading-relaxed"
        style={{ color: "#94a3b8" }}
      >
        When the AI decomposes a node, materializes a sticky, or ingests a
        file, the receipt lands here.
      </div>
    </div>
  );
}
